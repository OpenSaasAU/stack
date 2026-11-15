import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AccessContext } from '../access/types.js'
import { text } from '../fields/index.js'
import { engineContextOf } from '../context/engine-context.js'
import { createTestContext, type TestContext } from '../testing/context.js'
import { untypedRule } from '../testing/untyped-rule.js'
import type { OpenSaasConfig } from './types.js'
import { resolveNavCounts } from './nav-count.js'

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
      ReturnsNull: {
        fields: { title: text() },
        access: { operation: { create: () => true, query: untypedRule(() => null) } },
        ui: { navCount: true },
      },
      ReturnsUndefined: {
        fields: { title: text() },
        access: { operation: { create: () => true, query: untypedRule(() => undefined) } },
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
      const { _sessionVocabularyQuestions: _omitted, ...withoutVocabulary } = accessContext()
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

  test(
    'a vocabulary read that fails omits only its own badge and never rejects',
    async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const engine = accessContext()
        const failure = new Error('vocabulary failed')
        const failing: AccessContext = {
          ...engine,
          _sessionVocabularyQuestions: (listKey) => {
            const questions = engine._sessionVocabularyQuestions?.(listKey) ?? null
            if (questions === null || listKey !== 'Scoped') return questions
            return {
              ...questions,
              operation: async () => {
                throw failure
              },
            }
          },
        }

        const counts = await resolveNavCounts(failing, schemaConfig())

        expect(counts).toEqual({ Counted: 0 })
        expect(error).toHaveBeenCalledWith('Failed to resolve nav count for Scoped:', failure)
      } finally {
        error.mockRestore()
      }
    },
    BOOT,
  )

  test(
    'deciding a badge asks only the query rule of each opted-in list',
    async () => {
      const asked: string[] = []
      const counting = (name: string) => () => {
        asked.push(name)
        return true
      }
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql' },
        lists: {
          Counted: {
            fields: {
              title: text({
                access: { read: counting('title.read'), update: counting('title.update') },
              }),
            },
            access: {
              operation: {
                query: counting('query'),
                create: counting('create'),
                update: counting('update'),
                delete: counting('delete'),
              },
            },
            ui: { navCount: true },
          },
        },
      }
      const own = await createTestContext(config, null)
      try {
        asked.length = 0
        await resolveNavCounts(engineContextOf(own.context), config)
        expect(asked.filter((name) => name !== 'query')).toEqual([])
      } finally {
        await own.close()
      }
    },
    BOOT,
  )

  test(
    'a framework control-flow throw from deciding a badge propagates',
    async () => {
      const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
        digest: 'NEXT_REDIRECT;replace;/sign-in;307;',
      })
      const engine = accessContext()
      const redirecting: AccessContext = {
        ...engine,
        _sessionVocabularyQuestions: (listKey) => {
          const questions = engine._sessionVocabularyQuestions?.(listKey) ?? null
          if (questions === null) return null
          return {
            ...questions,
            operation: async () => {
              throw redirect
            },
          }
        },
      }

      await expect(resolveNavCounts(redirecting, schemaConfig())).rejects.toBe(redirect)
    },
    BOOT,
  )

  test(
    'a framework control-flow throw from the count itself propagates',
    async () => {
      const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
        digest: 'NEXT_REDIRECT;replace;/sign-in;307;',
      })
      const engine = accessContext()
      const counting: AccessContext = {
        ...engine,
        db: {
          ...engine.db,
          Counted: {
            ...engine.db.Counted,
            aggregate: async () => {
              throw redirect
            },
          },
        },
      }

      await expect(resolveNavCounts(counting, schemaConfig())).rejects.toBe(redirect)
    },
    BOOT,
  )
})
