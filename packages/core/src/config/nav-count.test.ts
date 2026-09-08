import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import type { AccessContext } from '../access/types.js'
import { text } from '../fields/index.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import type { OpenSaasConfig } from './types.js'
import { isListQueryStaticallyDenied, resolveNavCounts } from './nav-count.js'

/**
 * Nav counts (#735): which lists get a badge at all, and what happens when one
 * list's count fails.
 *
 * A count itself is read through `context.db[list].count()` — the Prisma 7
 * method surface `context/index.ts` still exposes and no rc.8 client serves.
 * Every count therefore currently takes the degradation path, which is exactly
 * what the last test here pins; the badge comes back with that surface (#1255).
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
      NotOptedIn: {
        fields: { title: text() },
        access: { operation: { query: () => true, create: () => true } },
      },
      Denied: {
        fields: { title: text() },
        access: { operation: { create: () => true } },
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
        const counts = await resolveNavCounts(accessContext(), schemaConfig())

        expect(Object.keys(counts)).not.toContain('NotOptedIn')
        expect(Object.keys(counts)).not.toContain('OnlySettings')
        expect(Object.keys(counts)).not.toContain('Denied')
        // A statically denied list is omitted before any query — a `0` there
        // would read as "empty" when the truth is "you may see none of it". It
        // was never attempted, so it never reached the degradation log either.
        expect(
          error.mock.calls.some((call) => String(call[0]).includes('nav count for Denied')),
        ).toBe(false)
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
        const counts = await resolveNavCounts(accessContext(), schemaConfig())

        expect(counts).toEqual({})
        expect(
          error.mock.calls.some((call) => String(call[0]).includes('nav count for Counted')),
        ).toBe(true)
      } finally {
        error.mockRestore()
      }
    },
    BOOT,
  )
})
