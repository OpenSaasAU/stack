import { describe, expect, it } from 'vitest'
import type { BaseFieldConfig, OpenSaasConfig, TypeInfo } from '../config/types.js'
import { relationship, text, virtual } from '../fields/index.js'
import { validateDatabaseConfig } from './database-config.js'
import { validateExtensionPacks } from './extension-packs.js'

const embedding: BaseFieldConfig<TypeInfo> = {
  type: 'vector',
  getContractField: (name) => ({
    kind: 'column',
    name,
    type: { pack: 'pgvector', type: 'Vector', args: [1536] },
    nullable: true,
  }),
}

const tiles: BaseFieldConfig<TypeInfo> = {
  type: 'tiles',
  getContractField: (name) => ({
    kind: 'columns',
    columns: [
      { name: `${name}_a`, type: { pack: 'pg', type: 'text' }, nullable: true },
      { name: `${name}_b`, type: { pack: 'postgis', type: 'Geometry' }, nullable: true },
    ],
  }),
}

describe('validateExtensionPacks', () => {
  it('accepts core scalars, relationships, virtuals, legacy fields, and a declared pack', () => {
    const config: OpenSaasConfig = {
      db: {
        provider: 'postgresql',
        extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
      },
      lists: {
        Document: {
          fields: {
            title: text(),
            embedding,
            author: relationship({ ref: 'User' }),
            summary: virtual({ type: 'string', hooks: { resolveOutput: () => '' } }),
            legacy: { type: 'legacy' },
          },
        },
        User: { fields: { name: text() } },
      },
    }
    expect(validateExtensionPacks(config)).toEqual([])
  })

  it('refuses a field typed by an undeclared pack, naming the list, the field and the pack', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: { Document: { fields: { title: text(), embedding } } },
    }
    const refusals = validateExtensionPacks(config)
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      listKey: 'Document',
      entry: 'fields.embedding',
      reason: 'undeclared-extension-pack',
    })
    expect(refusals[0].message).toContain('List "Document"')
    expect(refusals[0].message).toContain('fields.embedding')
    expect(refusals[0].message).toContain('"Vector" from extension pack "pgvector"')
    expect(refusals[0].message).toContain("{ name: 'pgvector', from:")
  })

  it('refuses a multi-column field once when any of its columns needs an undeclared pack', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: { Map: { fields: { tiles } } },
    }
    const refusals = validateExtensionPacks(config)
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({ listKey: 'Map', entry: 'fields.tiles' })
    expect(refusals[0].message).toContain('"Geometry" from extension pack "postgis"')
  })

  it('is part of validateDatabaseConfig', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: { Document: { fields: { embedding } } },
    }
    expect(validateDatabaseConfig(config).map((r) => r.reason)).toEqual([
      'undeclared-extension-pack',
    ])
  })
})
