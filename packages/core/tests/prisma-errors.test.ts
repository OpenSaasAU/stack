import { describe, it, expect } from 'vitest'
import { uniqueConstraintOf } from '../src/lib/prisma-errors.js'

// Fixtures below are the verified output captured during triage of issue #979
// (PGlite behind a Postgres wire-protocol socket, @prisma/adapter-pg@7.8.0,
// @prisma/client@7.8.0) — not a hand-invented shape.
const compositeDriverAdapterError = {
  code: 'P2002',
  meta: {
    modelName: 'Thing',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23505',
        originalMessage: 'duplicate key value violates unique constraint "thing_tenant_slug_key"',
        kind: 'UniqueConstraintViolation',
        constraint: { fields: ['"tenantId"', 'slug'] },
      },
    },
  },
}

const singleColumnDriverAdapterError = {
  code: 'P2002',
  meta: {
    modelName: 'Thing',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23505',
        originalMessage: 'duplicate key value violates unique constraint "thing_extRef_key"',
        kind: 'UniqueConstraintViolation',
        constraint: { fields: ['"extRef"'] },
      },
    },
  },
}

// This shape is read directly out of @prisma/adapter-better-sqlite3's own
// error-mapping source (its SQLITE_CONSTRAINT_UNIQUE branch), not hand-invented:
// `constraint.fields` comes unquoted (SQLite has no Postgres-style identifier
// quoting), and `originalMessage` ("UNIQUE constraint failed: Post.slug") has no
// quoted constraint name for the regex to recover.
const sqliteDriverAdapterError = {
  code: 'P2002',
  meta: {
    modelName: 'Post',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: 'SQLITE_CONSTRAINT_UNIQUE',
        originalMessage: 'UNIQUE constraint failed: Post.slug',
        kind: 'UniqueConstraintViolation',
        constraint: { fields: ['slug'] },
      },
    },
  },
}

describe('uniqueConstraintOf', () => {
  it('resolves fields and constraint name from a composite driver-adapter P2002', () => {
    expect(uniqueConstraintOf(compositeDriverAdapterError)).toEqual({
      fields: ['tenantId', 'slug'],
      constraintName: 'thing_tenant_slug_key',
    })
  })

  it('resolves fields (no constraint name) from a SQLite driver-adapter P2002', () => {
    // SQLite's error text carries no quoted constraint name, so this must
    // degrade to fields-only rather than leaving an empty/garbage name.
    expect(uniqueConstraintOf(sqliteDriverAdapterError)).toEqual({ fields: ['slug'] })
  })

  it('resolves a single-column driver-adapter P2002', () => {
    expect(uniqueConstraintOf(singleColumnDriverAdapterError)).toEqual({
      fields: ['extRef'],
      constraintName: 'thing_extRef_key',
    })
  })

  it('strips quotes only from identifiers Postgres quoted (camelCase), leaving plain names as-is', () => {
    const info = uniqueConstraintOf(compositeDriverAdapterError)
    // `tenantId` is camelCase and arrives quoted; `slug` is lowercase and does not.
    expect(info?.fields).toEqual(['tenantId', 'slug'])
  })

  it('prefers an already-populated meta.target and does not consult driverAdapterError', () => {
    const error = {
      code: 'P2002',
      meta: {
        target: ['email'],
        // Present but must be ignored — meta.target already wins.
        driverAdapterError: {
          cause: {
            originalMessage: 'duplicate key value violates unique constraint "other_key"',
            constraint: { fields: ['other'] },
          },
        },
      },
    }

    expect(uniqueConstraintOf(error)).toEqual({ fields: ['email'] })
  })

  it('returns undefined for a P2002 with no recoverable constraint information', () => {
    expect(uniqueConstraintOf({ code: 'P2002', meta: {} })).toBeUndefined()
    expect(uniqueConstraintOf({ code: 'P2002' })).toBeUndefined()
  })

  it('returns undefined for a non-P2002 error', () => {
    expect(uniqueConstraintOf({ code: 'P2025', meta: { target: ['email'] } })).toBeUndefined()
  })

  it('returns undefined for non-error values without throwing', () => {
    expect(uniqueConstraintOf(null)).toBeUndefined()
    expect(uniqueConstraintOf(undefined)).toBeUndefined()
    expect(uniqueConstraintOf('boom')).toBeUndefined()
    expect(uniqueConstraintOf({})).toBeUndefined()
  })

  it('never throws when the adapter error shape is malformed at any level', () => {
    expect(() =>
      uniqueConstraintOf({ code: 'P2002', meta: { driverAdapterError: null } }),
    ).not.toThrow()
    expect(() =>
      uniqueConstraintOf({ code: 'P2002', meta: { driverAdapterError: { cause: null } } }),
    ).not.toThrow()
    expect(() =>
      uniqueConstraintOf({
        code: 'P2002',
        meta: { driverAdapterError: { cause: { constraint: { fields: [1, null, 'ok'] } } } },
      }),
    ).not.toThrow()
    expect(
      uniqueConstraintOf({
        code: 'P2002',
        meta: { driverAdapterError: { cause: { constraint: { fields: [1, null, 'ok'] } } } },
      }),
    ).toEqual({ fields: ['ok'] })
  })
})
