import { describe, expect, test } from 'vitest'
import { deriveContract } from '../../core/src/contract/index.js'
import { deriveGeneratedTables } from '../../core/src/contract/dependencies.js'
import { filterReadableFields } from '../../core/src/access/field-visibility.js'
import { buildFieldSelectionScope, defineFragment } from '../../core/src/query/index.js'
import type { AccessContext } from '../../core/src/access/types.js'
import type { ContractModel } from '../../core/src/contract/types.js'
import type { FieldConfig, OpenSaasConfig } from '../../core/src/config/types.js'
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
 * Both packages depend on core, so this file — not `packages/core/tests` — is
 * where a fixture may import them without closing a workspace cycle.
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

  test('the remainder types each field through outputType, not resultExtension', () => {
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
 * ADR-0041's exact `.select()` terminal is spec 3's work and is not on this
 * branch. `defineFragment` + `buildFieldSelectionScope` is the projection
 * mechanism that exists — the same path #1131/#1137 tested — so this is where a
 * read that names only the logical field is exercised.
 */
describe('a projection naming only the logical field', () => {
  function accessContext(): AccessContext {
    return { session: null, _isSudo: false, _resolveOutputChain: [] } as unknown as AccessContext
  }

  const fields: Record<string, FieldConfig> = {
    hero: image({ storage: 'images', db: { columns: 'keystone' } }) as FieldConfig,
    title: { type: 'text' } as FieldConfig,
  }

  const heroOnly = defineFragment<{ hero: unknown }>()({ hero: true })

  test('assembles the metadata from the physical columns and leaves them out of the result', async () => {
    const row = {
      id: 'a',
      title: 'a legacy row',
      hero_url: '/uploads/hero.jpg',
      hero_width: 800,
      hero_height: 600,
      hero_filesize: 1024,
      hero_contentType: 'image/jpeg',
      hero_contentDisposition: null,
      hero_pathname: 'hero.jpg',
    }

    const result = await filterReadableFields(
      row,
      fields,
      { session: null, context: accessContext() },
      undefined,
      0,
      'Legacy',
      undefined,
      buildFieldSelectionScope(heroOnly._fields),
    )

    expect(result).toEqual({
      id: 'a',
      hero: {
        url: '/uploads/hero.jpg',
        width: 800,
        height: 600,
        size: 1024,
        mimeType: 'image/jpeg',
        filename: 'hero.jpg',
        originalFilename: 'hero.jpg',
        uploadedAt: expect.any(String),
        storageProvider: 'images',
      },
    })
    for (const column of Object.keys(row)) {
      if (column.startsWith('hero_')) expect(column in result).toBe(false)
    }
  })
})
