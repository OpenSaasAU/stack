import { describe, it, expect } from 'vitest'
import {
  DatabaseError,
  SerializationFailure,
  UniqueConstraintViolation,
  classifyDriverError,
  isSerializationFailure,
  isUniqueConstraintViolation,
} from '../src/lib/database-errors.js'
import { getConstraintMap, normalizeDatabaseError } from '../src/lib/prisma-errors.js'
import { text, relationship } from '../src/fields/index.js'
import type { OpenSaasConfig } from '../src/config/types.js'

/**
 * A driver query error shaped the way Prisma 8's `SqlQueryError` is: an
 * `Error` carrying `kind`, the driver-normalised SQLSTATE and the violated
 * constraint's physical name.
 */
function driverQueryError(
  message: string,
  detail: { sqlState?: string; constraint?: string } = {},
): Error {
  return Object.assign(new Error(message), { kind: 'sql_query', ...detail })
}

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Author: {
      fields: {
        email: text({ isIndexed: 'unique' }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
    },
    Post: {
      fields: {
        title: text(),
        publishedYear: text(),
        author: relationship({ ref: 'Author.posts' }),
      },
      db: { indexes: [{ fields: ['title', 'publishedYear'], unique: true }] },
    },
  },
}

describe('classifyDriverError', () => {
  it('maps SQLSTATE 40001 to SerializationFailure', () => {
    const classified = classifyDriverError(
      driverQueryError('could not serialize access', { sqlState: '40001' }),
    )

    expect(classified).toBeInstanceOf(SerializationFailure)
    expect(isSerializationFailure(classified)).toBe(true)
    expect(isUniqueConstraintViolation(classified)).toBe(false)
  })

  it('maps SQLSTATE 23505 to a unique violation carrying the constraint name', () => {
    const classified = classifyDriverError(
      driverQueryError('duplicate key', { sqlState: '23505', constraint: 'Author_email_key' }),
    )

    expect(isUniqueConstraintViolation(classified)).toBe(true)
    expect(classified).toBeInstanceOf(UniqueConstraintViolation)
    if (!isUniqueConstraintViolation(classified)) throw new Error('not classified')
    expect(classified.constraintName).toBe('Author_email_key')
    expect(classified.message).toBe('A record with this value already exists')
    expect(classified.fields).toEqual([])
  })

  it('wraps any other driver query error as a DatabaseError keeping its message', () => {
    const classified = classifyDriverError(
      driverQueryError('null value in column "title"', { sqlState: '23502' }),
    )

    expect(classified).toBeInstanceOf(DatabaseError)
    expect(isSerializationFailure(classified)).toBe(false)
    expect(isUniqueConstraintViolation(classified)).toBe(false)
    expect(classified?.message).toBe('null value in column "title"')
  })

  it('preserves the raised error as the cause', () => {
    const raised = driverQueryError('duplicate key', { sqlState: '23505' })
    expect(classifyDriverError(raised)?.cause).toBe(raised)
  })

  // Prisma 8 reports a failure raised at COMMIT as `RuntimeError: Transaction
  // commit failed` whose `cause` is the driver's own error.
  it('finds the driver error through a wrapper that carries it as its cause', () => {
    const driver = driverQueryError('duplicate key', {
      sqlState: '23505',
      constraint: 'Author_email_key',
    })
    const wrapper = new Error('Transaction commit failed', { cause: driver })

    const classified = classifyDriverError(wrapper)

    if (!isUniqueConstraintViolation(classified)) throw new Error('not classified')
    expect(classified.constraintName).toBe('Author_email_key')
    expect(classified.cause).toBe(wrapper)
  })

  it('stops at a cause chain that never reaches a driver error', () => {
    const deep = new Error('c', { cause: new Error('b', { cause: new Error('a') }) })
    expect(classifyDriverError(deep)).toBeUndefined()
  })

  it('leaves an error that is not a driver query error alone', () => {
    expect(classifyDriverError(new Error('a hook threw'))).toBeUndefined()
    expect(classifyDriverError({ kind: 'sql_query', sqlState: '23505' })).toBeUndefined()
    expect(classifyDriverError(null)).toBeUndefined()
    expect(classifyDriverError('boom')).toBeUndefined()
    expect(
      classifyDriverError(Object.assign(new Error('conn'), { kind: 'sql_connection' })),
    ).toBeUndefined()
  })

  it('is idempotent: an already-classified error is not reclassified', () => {
    const once = classifyDriverError(driverQueryError('dup', { sqlState: '23505' }))
    expect(classifyDriverError(once)).toBeUndefined()
  })
})

describe('the constraint map a violation is resolved through', () => {
  it('derives every constraint the generator emits when none was emitted into the config', () => {
    expect(Object.keys(getConstraintMap(config)).sort()).toEqual([
      'Author_email_key',
      'Author_pkey',
      'Post_pkey',
      'Post_title_publishedYear_key',
    ])
  })

  it('prefers the emitted map over deriving one', () => {
    const emitted = { Whatever_key: { list: 'Post', fields: ['title'] } }
    expect(
      getConstraintMap({ ...config, _tables: { dependencies: {}, constraints: emitted } }),
    ).toBe(emitted)
  })
})

describe('normalizeDatabaseError', () => {
  it('resolves a single-column generated constraint to one field message', () => {
    const normalized = normalizeDatabaseError(
      driverQueryError('duplicate key', { sqlState: '23505', constraint: 'Author_email_key' }),
      config,
    )

    if (!isUniqueConstraintViolation(normalized)) throw new Error('not a unique violation')
    expect(normalized.list).toBe('Author')
    expect(normalized.fields).toEqual(['email'])
    expect(normalized.fieldErrors).toEqual({ email: 'This email is already in use' })
    expect(normalized.message).toBe(
      'Email must be unique. The value you entered is already in use.',
    )
  })

  it('resolves a composite generated constraint to one message per field', () => {
    const normalized = normalizeDatabaseError(
      driverQueryError('duplicate key', {
        sqlState: '23505',
        constraint: 'Post_title_publishedYear_key',
      }),
      config,
    )

    if (!isUniqueConstraintViolation(normalized)) throw new Error('not a unique violation')
    expect(normalized.fields).toEqual(['title', 'publishedYear'])
    expect(normalized.fieldErrors).toEqual({
      title: 'This title is already in use',
      publishedYear: 'This published year is already in use',
    })
    expect(normalized.message).toBe(
      'Title, Published Year must be unique. The value you entered is already in use.',
    )
  })

  it('leaves a hand-made index on the generic message with no fields', () => {
    const normalized = normalizeDatabaseError(
      driverQueryError('duplicate key', {
        sqlState: '23505',
        constraint: 'post_title_lower_idx',
      }),
      config,
    )

    if (!isUniqueConstraintViolation(normalized)) throw new Error('not a unique violation')
    expect(normalized.constraintName).toBe('post_title_lower_idx')
    expect(normalized.fields).toEqual([])
    expect(normalized.fieldErrors).toEqual({})
    expect(normalized.message).toBe('A record with this value already exists')
  })

  it('leaves a violation the driver named no constraint for on the generic message', () => {
    const normalized = normalizeDatabaseError(
      driverQueryError('duplicate key', { sqlState: '23505' }),
      config,
    )

    if (!isUniqueConstraintViolation(normalized)) throw new Error('not a unique violation')
    expect(normalized.constraintName).toBeUndefined()
    expect(normalized.message).toBe('A record with this value already exists')
  })

  it('is idempotent over an already-resolved violation', () => {
    const once = normalizeDatabaseError(
      driverQueryError('duplicate key', { sqlState: '23505', constraint: 'Author_email_key' }),
      config,
    )
    expect(normalizeDatabaseError(once, config)).toBe(once)
  })

  it('returns a non-driver error unchanged', () => {
    const thrown = new Error('a hook threw')
    expect(normalizeDatabaseError(thrown, config)).toBe(thrown)
  })
})
