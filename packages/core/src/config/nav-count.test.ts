import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AccessContext } from '../access/types.js'
import { text } from '../fields/index.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import type { OpenSaasConfig } from './types.js'
import { isListQueryStaticallyDenied, resolveNavCounts } from './nav-count.js'

/**
 * Nav counts (#735): which lists get a badge at all, and what happens when one
 * list's count fails.
 *
 * A count is the secured `aggregate` reducer, so a badge reports exactly the
 * rows the session may see.
 */

const BOOT = 120_000

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Counted: {
        fields: { title: text() },
        access: { operation: { query: () => true, create: () => true } },
        ui: { navCount: true },
      },
      Scoped: {
        fields: { title: text() },
        access: {
          operation: { query: () => ({ title: { equals: 'visible' } }), create: () => true },
        },
        ui: { navCount: true },
      },
      NotOptedIn: {
        fields: { title: text() },
        access: { operation: { query: () => true, create: () => true } },
      },
      Denied: {
        fields: { title: text() },
        access: { operation: { create: () => true } },
        ui: { navCount: true },
      },
      Throws: {
        fields: { title: text() },
        access: {
          operation: {
            create: () => true,
            query: () => {
              throw new Error('boom')
            },
          },
        },
        ui: { navCount: true },
      },
      OnlySettings: {
        isSingleton: true,
        fields: { title: text() },
        access: { operation: { query: () => true, create: () => true } },
        ui: { navCount: true },
      },
    },
  }
}

describe('isListQueryStaticallyDenied', () => {
  test('absent query access is denied, matching the engine’s deny-by-default', () => {
    expect(isListQueryStaticallyDenied({ fields: {} })).toBe(true)
  })

  test('an access block that declares no query rule is denied too', () => {
    expect(isListQueryStaticallyDenied({ fields: {}, access: { operation: {} } })).toBe(true)
  })

  test('a function is decided per request, so it is not statically denied', () => {
    expect(
      isListQueryStaticallyDenied({ fields: {}, access: { operation: { query: () => false } } }),
    ).toBe(false)
  })
})

describe('resolveNavCounts', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), null)
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
  })

  /** The harness's context as the access engine's own shape. */
  function accessContext(): AccessContext {
    return {
      ...harness.context,
      ormHandle: ormClientFor(harness.data, harness.client.orm),
      _resolveOutputChain: [],
    }
  }

  test(
    'a list that did not opt in, a singleton and a statically denied list are never counted',
    async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        await harness.context.db.Counted.create({ data: { title: 'one' } })
        await harness.context.db.Counted.create({ data: { title: 'two' } })

        const counts = await resolveNavCounts(accessContext(), schemaConfig())

        // Only the opted-in, queryable list has a badge, and it carries the
        // access-scoped total. A statically denied list is omitted before any
        // query for its own reason: a `0` would read as "empty" when the truth
        // is "you may see none of it".
        expect(counts).toEqual({ Counted: 2, Scoped: 0 })
      } finally {
        error.mockRestore()
      }
    },
    BOOT,
  )

  test(
    'a filter-scoped rule counts only the rows that filter admits',
    async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        await harness.context.db.Scoped.create({ data: { title: 'visible' } })
        await harness.context.db.Scoped.create({ data: { title: 'visible' } })
        await harness.context.db.Scoped.create({ data: { title: 'hidden' } })

        const counts = await resolveNavCounts(accessContext(), schemaConfig())

        // The badge is the reducer run under the same filter a list read gets,
        // so the hidden row is absent from the total rather than hidden from
        // the page but counted in the chrome.
        expect(counts.Scoped).toBe(2)
      } finally {
        error.mockRestore()
      }
    },
    BOOT,
  )

  test(
    'a count that fails omits only its own badge and never rejects',
    async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        await harness.context.db.Counted.create({ data: { title: 'one' } })

        const counts = await resolveNavCounts(accessContext(), schemaConfig())

        expect(Object.keys(counts)).not.toContain('Throws')
        expect(counts.Counted).toBeGreaterThan(0)
        expect(
          error.mock.calls.some((call) => String(call[0]).includes('nav count for Throws')),
        ).toBe(true)
      } finally {
        error.mockRestore()
      }
    },
    BOOT,
  )
})
