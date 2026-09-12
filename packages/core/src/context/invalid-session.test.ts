import { describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { OrmClient } from '../access/types.js'
import { text } from '../fields/index.js'
import { createTestContext } from '../testing/context.js'
import { getContext, InvalidSessionError } from './index.js'

/**
 * `getContext({ userId: undefined })` used to store the object as-is —
 * `session ?? null` only special-cases `null`/`undefined` themselves, never
 * a property holding it — so a session built from an unguarded optional
 * identifier reached every access rule as signed in. This is the regression
 * PR #1387 found on `examples/blog`'s `getPost` (#1397): an anonymous caller
 * read an unpublished draft because `{ userId: undefined }` is truthy.
 *
 * `withSession` and `createTestContext` both route through the same
 * low-level `getContext`, so one guard there closes the hole for all three.
 */

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Post: {
        fields: { title: text() },
        access: {
          operation: {
            // A session that merely LOOKS signed in must never reach `true`.
            query: ({ session }) => session !== null,
            create: () => true,
            update: () => true,
            delete: () => true,
          },
        },
      },
    },
  }
}

describe('a session holding an undefined-valued key', () => {
  test('the low-level getContext refuses it rather than treating it as signed in', () => {
    const ormHandle: OrmClient = {}

    expect(() => getContext(schemaConfig(), ormHandle, { userId: undefined })).toThrow(
      InvalidSessionError,
    )
  })

  test('the error names the offending key', () => {
    const ormHandle: OrmClient = {}

    try {
      getContext(schemaConfig(), ormHandle, { userId: undefined, role: undefined })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidSessionError)
      expect((error as InvalidSessionError).keys).toEqual(['userId', 'role'])
    }
  })

  test('withSession refuses the same shape', () => {
    const ormHandle: OrmClient = {}
    const context = getContext(schemaConfig(), ormHandle, { userId: 'ada' })

    expect(() => context.withSession({ userId: undefined })).toThrow(InvalidSessionError)
  })

  test('createTestContext refuses the same shape, and leaves no database running', async () => {
    await expect(createTestContext(schemaConfig(), { userId: undefined })).rejects.toThrow(
      InvalidSessionError,
    )
  }, 120_000)

  test('null, and a session with no undefined keys, are unaffected', () => {
    const ormHandle: OrmClient = {}

    expect(getContext(schemaConfig(), ormHandle, null).session).toBeNull()
    expect(getContext(schemaConfig(), ormHandle, { userId: 'ada' }).session).toEqual({
      userId: 'ada',
    })
  })
})
