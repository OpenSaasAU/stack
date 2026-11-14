import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AccessContext } from '../access/types.js'
import { text } from '../fields/index.js'
import { engineContextOf } from '../context/engine-context.js'
import { createTestContext, type TestContext } from '../testing/context.js'
import type { OpenSaasConfig } from './types.js'
import { resolveNavCounts } from './nav-count.js'

const BOOT = 120_000

function nothing(answer: null | undefined): () => boolean
function nothing(answer: null | undefined): () => boolean | null | undefined {
  return () => answer
}

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
      ReturnsNull: {
        fields: { title: text() },
        access: { operation: { create: () => true, query: nothing(null) } },
        ui: { navCount: true },
      },
      ReturnsUndefined: {
        fields: { title: text() },
        access: { operation: { create: () => true, query: nothing(undefined) } },
        ui: { navCount: true },
      },
      CountFails: {
        fields: { title: text() },
        access: {
          operation: { create: () => true, query: () => ({ missing: { equals: 'x' } }) },
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

  function accessContext(): AccessContext {
    return engineContextOf(harness.context)
  }

  test(
    'a list that did not opt in, a singleton and a list the session may not query are never counted',
    async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        await harness.context.db.Counted.create({ data: { title: 'one' } })
        await harness.context.db.Counted.create({ data: { title: 'two' } })

        const counts = await resolveNavCounts(accessContext(), schemaConfig())

        expect(counts).toEqual({ Counted: 2, Scoped: 0 })
      } finally {
        error.mockRestore()
        warn.mockRestore()
      }
    },
    BOOT,
  )

  test.each(['ReturnsNull', 'ReturnsUndefined'])(
    'a list whose query rule answers nothing (%s) has no count, and is never queried',
    async (listKey) => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const counts = await resolveNavCounts(accessContext(), schemaConfig())

        expect(Object.keys(counts)).not.toContain(listKey)
        expect(counts.Counted).toBe(0)
        expect(error.mock.calls.some((call) => String(call[0]).includes(listKey))).toBe(false)
      } finally {
        error.mockRestore()
        warn.mockRestore()
      }
    },
    BOOT,
  )

  test(
    'a context that resolves no Session vocabulary counts nothing',
    async () => {
      const { _sessionVocabulary: _omitted, ...withoutVocabulary } = accessContext()
      const counts = await resolveNavCounts(withoutVocabulary, schemaConfig())
      expect(counts).toEqual({})
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
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        await harness.context.db.Counted.create({ data: { title: 'one' } })

        const counts = await resolveNavCounts(accessContext(), schemaConfig())

        expect(Object.keys(counts)).not.toContain('CountFails')
        expect(counts.Counted).toBeGreaterThan(0)
        expect(
          error.mock.calls.some((call) => String(call[0]).includes('nav count for CountFails')),
        ).toBe(true)
      } finally {
        error.mockRestore()
        warn.mockRestore()
      }
    },
    BOOT,
  )
})
