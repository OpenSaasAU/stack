import { readFileSync } from 'fs'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { config as defineConfig, validateConfigFields } from '@opensaas/stack-core'
import type { FieldConfigValidationError, OpenSaasConfig } from '@opensaas/stack-core'
import { executeBeforeGenerateHooks } from '@opensaas/stack-core/config/plugin-engine'
import { text } from '@opensaas/stack-core/fields'
import { ragPlugin } from '@opensaas/stack-rag'
import { embedding, searchable } from '@opensaas/stack-rag/fields'
import {
  CONSUMER_PRELUDE,
  emitTypeFixture,
  type TypeFixture,
} from '../../tests/emit-type-fixture.js'

/**
 * `nearest()` over the real `embedding()`, on the surface a generated project
 * gets.
 *
 * `types-read-terminals.test.ts` declares its own single-column `kind: 'column'`
 * stub so its fixture owns no plugin. The shipped field is a two-column
 * `kind: 'columns'` descriptor contributed by `ragPlugin`, and #1253's defect
 * class — an API documented on core's untyped `SecuredQuery` that was `TS2339`
 * from a generated project — is only closed for it by compiling against
 * `./.opensaas/types.ts` emitted from that field.
 */
const source: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  plugins: [ragPlugin({ provider: { type: 'openai', apiKey: 'test-key' } })],
  lists: {
    Article: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        content: text(),
        contentEmbedding: embedding({ sourceField: 'content', dimensions: 1536 }),
        // The high-level wrapper: the plugin derives a companion embedding
        // field from it, so generation has to carry both the wrapped text
        // column and the derived vector pair.
        summary: searchable(text(), { dimensions: 1536 }),
      },
    },
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The emitted contract's `Article` model, from `domain.namespaces.public.models`. */
function emittedArticle(json: string): Record<string, unknown> {
  let node: unknown = JSON.parse(json)
  for (const key of ['domain', 'namespaces', 'public', 'models', 'Article']) {
    if (!isRecord(node)) throw new Error(`the emitted contract has no "${key}" under it`)
    node = node[key]
  }
  if (!isRecord(node)) throw new Error('the emitted contract has no Article model')
  return node
}

describe('nearest() over a plugin-injected embedding column', () => {
  let fixture: TypeFixture
  let fieldErrors: FieldConfigValidationError[]

  beforeAll(async () => {
    // The order `pnpm generate` runs in: the plugins' beforeGenerate hooks,
    // then core's field self-containment gate, then the contract.
    const generated = await executeBeforeGenerateHooks(await defineConfig(source))
    fieldErrors = validateConfigFields(generated)
    fixture = await emitTypeFixture('rag-embedding', generated)
  }, 300_000)

  afterAll(() => {
    fixture?.cleanup()
  })

  it('passes the self-containment gate, which runs before the contract is read', () => {
    expect(fieldErrors).toEqual([])
  })

  it('emits a vector column and a jsonb column beside it, and no Json', () => {
    const emitted = readFileSync(join(fixture.projectDir, 'prisma', 'contract.json'), 'utf-8')
    const fields: unknown = Reflect.get(emittedArticle(emitted), 'fields')
    if (!isRecord(fields)) throw new Error('the emitted Article carries no fields')

    expect(fields.contentEmbedding).toEqual({
      nullable: true,
      type: { codecId: 'pg/vector@1', kind: 'scalar', typeParams: { length: 1536 } },
    })
    expect(fields.contentEmbeddingMetadata).toEqual({
      nullable: true,
      type: { codecId: 'pg/jsonb@1', kind: 'scalar' },
    })

    expect(emitted).not.toContain('Json')
  })

  it('emits the wrapped text column and the companion pair searchable() derives', () => {
    const emitted = readFileSync(join(fixture.projectDir, 'prisma', 'contract.json'), 'utf-8')
    const fields: unknown = Reflect.get(emittedArticle(emitted), 'fields')
    if (!isRecord(fields)) throw new Error('the emitted Article carries no fields')

    expect(fields.summary).toEqual({
      nullable: true,
      type: { codecId: 'pg/text@1', kind: 'scalar' },
    })
    expect(fields.summaryEmbedding).toEqual({
      nullable: true,
      type: { codecId: 'pg/vector@1', kind: 'scalar', typeParams: { length: 1536 } },
    })
  })

  it('compiles nearest() against the emitted contract', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context
declare const queryVector: number[]

async function run() {
  const hits = await context.db.Article.where({ title: { contains: 'pg' } }).nearest(
    'contentEmbedding',
    queryVector,
    { limit: 5, minScore: 0.8 },
  )

  for (const { item, score } of hits) {
    console.log(item.title, score)
  }

  assertType<Exact<(typeof hits)[number]['score'], number>>()

  // @ts-expect-error the metadata column is not a vector column of this list
  await context.db.Article.nearest('contentEmbeddingMetadata', queryVector)

  // @ts-expect-error \`content\` is a text column, not a vector one
  await context.db.Article.nearest('content', queryVector)
}

void run
`)

    expect(output).toBe('')
  })

  it('reads the embedding back as the value the field declares', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'
import type { StoredEmbedding } from '@opensaas/stack-rag'

declare const context: Context

async function run() {
  const article = await context.db.Article.where({}).first()
  if (article === null) return

  assertType<Exact<typeof article.contentEmbedding, StoredEmbedding | null>>()
}

void run
`)

    expect(output).toBe('')
  })
})
