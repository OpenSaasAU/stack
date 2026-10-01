import { describe, it, expect } from 'vitest'
import { validateDatabaseConfig } from './database-config.js'
import { text, timestamp } from '../fields/index.js'
import type { OpenSaasConfig } from '../config/types.js'

describe('validateDatabaseConfig', () => {
  it('accepts a config using every new db key', () => {
    const config: OpenSaasConfig = {
      db: {
        provider: 'postgresql',
        idField: 'uuid7',
        extensions: [
          { name: 'pgvector', from: '@prisma/orm-extension-pgvector' },
          { name: 'pgvector', from: '@prisma/orm-extension-pgvector' },
        ],
        client: { poolOptions: { idleTimeoutMillis: 1000 } },
      },
      lists: {
        Invoice: {
          fields: { total: text() },
          db: { idField: 'int autoincrement', indexes: [{ fields: ['total'], unique: true }] },
        },
        Settings: { fields: { siteName: text() }, isSingleton: true },
      },
    }

    expect(validateDatabaseConfig(config)).toEqual([])
  })

  it('refuses a sort direction on a db.indexes field reference, naming the list and the entry', () => {
    const sorted: { field: string; sort: 'desc' } = { field: 'createdAt', sort: 'desc' }
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        AuthVerification: {
          fields: { identifier: text(), createdAt: timestamp() },
          db: { indexes: [{ fields: ['identifier'] }, { fields: ['identifier', sorted] }] },
        },
      },
    }

    const refusals = validateDatabaseConfig(config)

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      listKey: 'AuthVerification',
      entry: 'db.indexes[1]',
      reason: 'index-sort',
    })
    expect(refusals[0].message).toContain('List "AuthVerification"')
    expect(refusals[0].message).toContain('db.indexes[1]')
    expect(refusals[0].message).toContain('"createdAt"')
    expect(refusals[0].message).toContain('Remove "sort"')
  })

  it('accepts a field reference whose sort is present but undefined', () => {
    const unsorted: { field: string; sort: undefined } = { field: 'createdAt', sort: undefined }
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        AuthVerification: {
          fields: { identifier: text(), createdAt: timestamp() },
          db: { indexes: [{ fields: ['identifier', unsorted] }] },
        },
      },
    }

    expect(validateDatabaseConfig(config)).toEqual([])
  })

  it('refuses db.idField on a singleton list, naming the list and the entry', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Settings: {
          fields: { siteName: text() },
          isSingleton: { autoCreate: false },
          db: { idField: 'cuid2' },
        },
      },
    }

    const refusals = validateDatabaseConfig(config)

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      listKey: 'Settings',
      entry: 'db.idField',
      reason: 'id-field-on-singleton',
    })
    expect(refusals[0].message).toContain('List "Settings"')
    expect(refusals[0].message).toContain('db.idField is "cuid2"')
    expect(refusals[0].message).toContain('Remove db.idField from "Settings"')
  })

  it('refuses the same pack name declared from two packages, naming both entries', () => {
    const config: OpenSaasConfig = {
      db: {
        provider: 'postgresql',
        extensions: [
          { name: 'pgvector', from: '@prisma/orm-extension-pgvector' },
          { name: 'pgvector', from: '@acme/vector-pack' },
        ],
      },
      lists: {},
    }

    const refusals = validateDatabaseConfig(config)

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      entry: 'db.extensions[1]',
      reason: 'duplicate-extension-pack',
    })
    expect(refusals[0].listKey).toBeUndefined()
    expect(refusals[0].message).toContain('db.extensions[1]')
    expect(refusals[0].message).toContain('db.extensions[0]')
    expect(refusals[0].message).toContain('"@acme/vector-pack"')
    expect(refusals[0].message).toContain('"@prisma/orm-extension-pgvector"')
  })

  it('refuses an unknown list-level db.idField, naming the list and the accepted strategies', () => {
    const config = {
      db: { provider: 'postgresql' },
      lists: { A: { fields: { x: text() }, db: { idField: 'serial' } } },
    } as unknown as OpenSaasConfig
    const refusals = validateDatabaseConfig(config)
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      listKey: 'A',
      entry: 'db.idField',
      reason: 'unknown-id-field',
    })
    expect(refusals[0].message).toContain("'uuid7' | 'cuid2' | 'int autoincrement'")
  })

  it('refuses the composite id form with its own message, and an unknown config-level idField', () => {
    const config = {
      db: { provider: 'postgresql', idField: 'serial' },
      lists: { A: { fields: { x: text() }, db: { idField: { fields: ['x', 'y'] } } } },
    } as unknown as OpenSaasConfig
    const refusals = validateDatabaseConfig(config)
    expect(refusals).toHaveLength(2)
    expect(
      refusals.some((r) => r.message.includes('Composite primary keys are out of scope')),
    ).toBe(true)
  })
})
