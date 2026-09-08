import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { deriveContract } from '../../core/src/contract/index.js'
import { deriveGeneratedTables } from '../../core/src/contract/dependencies.js'
import { text, virtual } from '../../core/src/fields/index.js'
import { withOrigin } from '../../core/src/origin.js'
import { createTestDatabase, type TestDatabase } from '../../core/src/testing/context.js'
import { createPlanRecorder, type RecordedPlan } from '../../core/src/testing/plans.js'
import type { ContractModel } from '../../core/src/contract/types.js'
import type { OpenSaasConfig } from '../../core/src/config/types.js'
import { file, image } from '../../storage/src/fields/index.js'
import { richText } from '../../tiptap/src/fields/richText.js'
import { generateTypes } from '../src/generator/types.js'
import { fieldPackageConfig } from './fixtures/field-package-configs.js'

/**
 * `@opensaas/stack-storage` and `@opensaas/stack-tiptap` on the contract-shaped
 * field-builder surface (#1167). The equivalence snapshot in
 * `contract-equivalence.test.ts` carries the same fixture through the rendered
 * module and the `tsc` pass; these assertions name what each package's
 * descriptor is supposed to say.
 *
 * Both packages depend on core, so this file — not core's own suite — is where
 * a fixture may import them without closing a workspace cycle.
 */

function modelOf(config: OpenSaasConfig, name: string): ContractModel {
  const model = deriveContract(config).models.find((candidate) => candidate.name === name)
  if (!model) throw new Error(`No model "${name}" in the derived contract`)
  return model
}

function columnNames(model: ContractModel): string[] {
  return model.columns.map((column) => column.name)
}

describe('the single-column backing', () => {
  const article = modelOf(fieldPackageConfig, 'Article')

  test('image(), file() and richText() each emit one jsonb column under the field key', () => {
    for (const name of ['hero', 'attachment', 'teaser', 'body']) {
      const column = article.columns.find((candidate) => candidate.name === name)
      expect(column?.type).toEqual({ pack: 'pg', type: 'jsonb' })
    }
  })

  test('nullability follows validation.isRequired for richText and is always nullable for storage', () => {
    const nullable = Object.fromEntries(article.columns.map((c) => [c.name, c.nullable]))
    expect(nullable).toMatchObject({
      body: false,
      teaser: true,
      hero: true,
      attachment: true,
    })
  })

  test('the storage db overrides the field documents reach the column', () => {
    const model = modelOf(
      {
        db: { provider: 'postgresql' },
        lists: {
          Doc: {
            fields: {
              attachment: file({
                storage: 'documents',
                db: { map: 'attachment_blob', isNullable: false, nativeType: 'Json' },
              }),
            },
          },
        },
      },
      'Doc',
    )
    expect(model.columns).toEqual([
      {
        name: 'attachment',
        type: { pack: 'pg', type: 'json' },
        map: 'attachment_blob',
        nullable: false,
      },
    ])
  })
})

describe('the multi-column backing', () => {
  const legacy = modelOf(fieldPackageConfig, 'Legacy')

  test('one logical image() field splits into its seven physical columns', () => {
    expect(columnNames(legacy)).toEqual(
      expect.arrayContaining([
        'hero_url',
        'hero_width',
        'hero_height',
        'hero_filesize',
        'hero_contentType',
        'hero_contentDisposition',
        'hero_pathname',
      ]),
    )
    expect(columnNames(legacy)).not.toContain('hero')
  })

  test('the physical columns keep their per-part types and are all nullable', () => {
    const byName = Object.fromEntries(legacy.columns.map((c) => [c.name, c]))
    expect(byName.hero_width.type).toEqual({ pack: 'pg', type: 'int' })
    expect(byName.hero_url.type).toEqual({ pack: 'pg', type: 'text' })
    expect(byName.attachment_filesize.type).toEqual({ pack: 'pg', type: 'int' })
    expect(legacy.columns.filter((c) => c.name.includes('_')).every((c) => c.nullable)).toBe(true)
  })

  test('a per-part name override moves only that column', () => {
    expect(columnNames(legacy)).toEqual(expect.arrayContaining(['brochure_href']))
    expect(columnNames(legacy)).not.toContain('brochure_url')
    expect(columnNames(legacy)).toContain('brochure_filename')
  })

  test('the logical key still owns its physical columns, so a db.indexes entry naming it is refused', () => {
    // `deriveIndexes` resolves an entry against the list's own field keys, and
    // a multi-column field has no single column to point one at.
    expect(() =>
      deriveContract({
        db: { provider: 'postgresql' },
        lists: {
          Legacy: {
            fields: { hero: image({ storage: 'images', db: { columns: 'keystone' } }) },
            db: { indexes: [{ fields: ['hero'] }] },
          },
        },
      }),
    ).toThrow(/"hero", which maps to more than one database column/)
  })
})

describe('the TypeScript face', () => {
  const types = generateTypes(
    fieldPackageConfig,
    deriveGeneratedTables(fieldPackageConfig, deriveContract(fieldPackageConfig)).dependencies,
  )

  test('the remainder types each field through its declared outputType', () => {
    expect(types).toContain("hero: import('@opensaas/stack-storage').ImageMetadata | null")
    expect(types).toContain("attachment: import('@opensaas/stack-storage').FileMetadata | null")
    expect(types).toContain("body: import('@opensaas/stack-tiptap').JSONContent")
    expect(types).toContain("teaser: import('@opensaas/stack-tiptap').JSONContent | null")
  })

  test('a write accepts the File the field uploads as well as already-shaped metadata', () => {
    expect(types).toContain("hero: File | import('@opensaas/stack-storage').ImageMetadata | null")
  })

  test('a caller-supplied outputType wins over the builder default', () => {
    const custom = image({ storage: 'images', outputType: 'string | null' })
    expect(custom.outputType).toBe('string | null')
    expect(richText({ outputType: 'string' }).outputType).toBe('string')
  })
})

/**
 * A field package's multi-column field under exact selection, through a real
 * table (spec 8, story 4). A `.select()` naming a computed field alone must
 * still deliver that field's declared dependency to its `resolveOutput` hook,
 * and here the declaration names a FIELD KEY the contract has no column for —
 * the widening has to resolve it to the part columns (ADR-0051).
 *
 * `blind` is the control: the same hook, declaring nothing. A read that handed
 * every hook the row's whole width would make `badge` pass on its own, so the
 * pair is what makes either assertion mean anything.
 */
describe('a projection naming only a computed field that declares a multi-column one', () => {
  function heroOf(item: Record<string, unknown>): string {
    const hero = item.hero
    if (hero === undefined) return 'undefined'
    if (hero === null || typeof hero !== 'object') return String(hero)
    return `${String(Reflect.get(hero, 'filename'))} (${String(Reflect.get(hero, 'size'))})`
  }

  const projectionConfig: OpenSaasConfig = {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Legacy: {
        fields: {
          title: text(),
          hero: image({ storage: 'images', db: { columns: 'keystone' } }),
          badge: virtual({
            type: 'string',
            needs: ['hero'],
            hooks: { resolveOutput: ({ item }) => heroOf(item) },
          }),
          blind: virtual({
            type: 'string',
            hooks: { resolveOutput: ({ item }) => heroOf(item) },
          }),
        },
        access: { operation: { query: () => true } },
      },
    },
  }

  const recorder = createPlanRecorder()
  let database: TestDatabase

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }

  /** Seeded through the Unsafe origin: the write surface is another spec's. */
  async function seedLegacy(): Promise<void> {
    const namespace: unknown = Reflect.get(database.client.orm, 'public')
    if (!isRecord(namespace)) throw new Error('no public namespace')
    const legacy: unknown = Reflect.get(namespace, 'Legacy')
    if (!isRecord(legacy)) throw new Error('no Legacy collection')
    const create: unknown = legacy.create
    if (typeof create !== 'function') throw new Error('Legacy has no create')
    await withOrigin('unsafe', async () => {
      await create.call(legacy, {
        title: 'a legacy row',
        hero_url: '/uploads/hero.jpg',
        hero_width: 800,
        hero_height: 600,
        hero_filesize: 1024,
        hero_contentType: 'image/jpeg',
        hero_pathname: 'hero.jpg',
      })
    })
  }

  /** Every column the recorded plan projects, in the alias the decoder reads it back under. */
  function projectedColumns(plan: RecordedPlan | undefined): string[] {
    const ast: unknown = plan?.ast
    if (!isRecord(ast)) return []
    const projection: unknown = ast.projection
    if (!Array.isArray(projection)) return []
    return projection
      .map((entry) => (isRecord(entry) && typeof entry.alias === 'string' ? entry.alias : ''))
      .filter((alias) => alias !== '')
      .sort()
  }

  beforeAll(async () => {
    database = await createTestDatabase(projectionConfig, { middleware: [recorder.middleware] })
    await seedLegacy()
  }, 120_000)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(() => {
    recorder.clear()
  })

  test('the declared multi-column field reaches its hook, resolved to the part columns', async () => {
    const rows = await database.context({}).db.Legacy.select('badge').all()

    expect(projectedColumns(recorder.plans[0])).toEqual([
      'createdAt',
      'hero_contentDisposition',
      'hero_contentType',
      'hero_filesize',
      'hero_height',
      'hero_pathname',
      'hero_url',
      'hero_width',
      'id',
      'updatedAt',
    ])
    expect(rows[0].badge).toBe('hero.jpg (1024)')
  }, 120_000)

  test('the same hook declaring nothing reads undefined on the same row', async () => {
    const rows = await database.context({}).db.Legacy.select('badge', 'blind').all()

    expect(rows[0].badge).toBe('hero.jpg (1024)')
    expect(rows[0].blind).toBe('undefined')
  }, 120_000)

  test('neither the logical key nor its part columns reach the caller', async () => {
    const rows = await database.context({}).db.Legacy.select('badge').all()

    expect(rows[0]).not.toHaveProperty('hero')
    for (const key of Object.keys(rows[0])) expect(key.startsWith('hero_')).toBe(false)
  }, 120_000)
})
