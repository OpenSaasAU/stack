import { readFileSync } from 'fs'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { validateConfigFields } from '@opensaas/stack-core'
import type { FieldConfigValidationError } from '@opensaas/stack-core'
import { fieldPackageConfig } from '../../tests/fixtures/field-package-configs.js'
import {
  CONSUMER_PRELUDE,
  emitTypeFixture,
  type TypeFixture,
} from '../../tests/emit-type-fixture.js'

/**
 * `@opensaas/stack-storage` and `@opensaas/stack-tiptap` carried through the
 * path `pnpm generate` actually runs — the self-containment gate, then
 * `prisma contract emit`, then a `tsc` pass over the emitted bundle.
 *
 * `field-packages-contract.test.ts` asserts what each package's descriptor
 * *says*; this file asserts that generation completes and emits the right
 * columns for it. Both of #1168's and #1139's near-misses — a field declaring
 * only `getContractField` failing the gate, and a false PSL type nothing could
 * honour — passed every package suite while `pnpm generate` was broken, and
 * only a run of this shape catches that (#1278).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** One model's `fields` map out of the emitted contract. */
function emittedFields(json: string, model: string): Record<string, unknown> {
  let node: unknown = JSON.parse(json)
  for (const key of ['domain', 'namespaces', 'public', 'models', model, 'fields']) {
    if (!isRecord(node)) throw new Error(`the emitted contract has no "${key}" under it`)
    node = node[key]
  }
  if (!isRecord(node)) throw new Error(`the emitted "${model}" carries no fields`)
  return node
}

describe('generation over the storage and tiptap field packages', () => {
  let fixture: TypeFixture
  let fieldErrors: FieldConfigValidationError[]
  let emitted: string

  beforeAll(async () => {
    // The order `pnpm generate` runs in: core's field self-containment gate,
    // then the contract. (The fixture declares no plugins, so there are no
    // beforeGenerate hooks to run between them.)
    fieldErrors = validateConfigFields(fieldPackageConfig)
    fixture = await emitTypeFixture('field-packages', fieldPackageConfig)
    emitted = readFileSync(join(fixture.projectDir, 'prisma', 'contract.json'), 'utf-8')
  }, 300_000)

  afterAll(() => {
    fixture?.cleanup()
  })

  it('passes the self-containment gate, which runs before the contract is read', () => {
    expect(fieldErrors).toEqual([])
  })

  it('emits one jsonb column per single-column storage and tiptap field', () => {
    const fields = emittedFields(emitted, 'Article')
    const jsonb = { nullable: true, type: { codecId: 'pg/jsonb@1', kind: 'scalar' } }

    expect(fields.hero).toEqual(jsonb)
    expect(fields.attachment).toEqual(jsonb)
    expect(fields.teaser).toEqual(jsonb)
    expect(fields.body).toEqual({
      nullable: false,
      type: { codecId: 'pg/jsonb@1', kind: 'scalar' },
    })
  })

  it('emits one column per part for a multi-column storage field, and none under the field key', () => {
    const fields = emittedFields(emitted, 'Legacy')
    const text = { nullable: true, type: { codecId: 'pg/text@1', kind: 'scalar' } }

    expect(fields.hero).toBeUndefined()
    expect(fields.hero_url).toEqual(text)
    expect(fields.hero_width).toEqual({
      nullable: true,
      type: { codecId: 'pg/int4@1', kind: 'scalar' },
    })
    expect(fields.hero_filesize).toEqual({
      nullable: true,
      type: { codecId: 'pg/int4@1', kind: 'scalar' },
    })
    expect(fields.hero_contentType).toEqual(text)

    expect(fields.attachment).toBeUndefined()
    expect(fields.attachment_filename).toEqual(text)
    expect(fields.attachment_url).toEqual(text)

    // The per-part rename moves only that column.
    expect(fields.brochure_href).toEqual(text)
    expect(fields.brochure_url).toBeUndefined()
  })

  it('emits no jsonb column for a multi-column field, whose parts are text and int', () => {
    const fields = emittedFields(emitted, 'Legacy')
    const codecs = Object.values(fields)
      .filter(isRecord)
      .map((field) => (isRecord(field.type) ? field.type.codecId : undefined))

    expect(codecs).not.toContain('pg/jsonb@1')
  })

  it('compiles a read of each field against the emitted contract', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'
import type { FileMetadata, ImageMetadata } from '@opensaas/stack-storage'
import type { JSONContent } from '@opensaas/stack-tiptap'

declare const context: Context

async function run() {
  const article = await context.db.Article.where({ title: { contains: 'x' } }).first()
  if (article === null) return

  assertType<Exact<typeof article.hero, ImageMetadata | null>>()
  assertType<Exact<typeof article.attachment, FileMetadata | null>>()
  assertType<Exact<typeof article.body, JSONContent>>()
  assertType<Exact<typeof article.teaser, JSONContent | null>>()

  // The multi-column field reads under its logical key.
  const legacy = await context.db.Legacy.where({ title: { contains: 'x' } }).first()
  if (legacy === null) return
  assertType<Exact<typeof legacy.hero, ImageMetadata | null>>()
}
void run
`)
    expect(output).toBe('')
  })

  it('accepts a File on write where the field uploads one', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context
declare const upload: File

async function run() {
  await context.db.Article.create({ data: { title: 'a', body: { type: 'doc' }, hero: upload } })

  await context.db.Article.create({
    // @ts-expect-error a number is neither a File nor already-shaped metadata
    data: { title: 'a', body: { type: 'doc' }, hero: 3 },
  })
}
void run
`)
    expect(output).toBe('')
  })
})
