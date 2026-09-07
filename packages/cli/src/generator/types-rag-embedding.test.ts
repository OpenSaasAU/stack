import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { config as defineConfig } from '@opensaas/stack-core'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { ragPlugin } from '@opensaas/stack-rag'
import { embedding } from '@opensaas/stack-rag/fields'
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
      },
    },
  },
}

describe('nearest() over a plugin-injected embedding column', () => {
  let fixture: TypeFixture

  beforeAll(async () => {
    fixture = await emitTypeFixture('rag-embedding', await defineConfig(source))
  }, 300_000)

  afterAll(() => {
    fixture?.cleanup()
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
