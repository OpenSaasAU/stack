import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { AccessContext, Session } from './types.js'
import { resolveNavCounts } from '../config/nav-count.js'
import { getContext } from '../context/index.js'
import { engineContextOf } from '../context/engine-context.js'
import type { StackContext } from '../types/context.js'
import { processLifetimeContext } from '../context/process-lifetime.js'
import { text, virtual } from '../fields/index.js'
import { createMcpHandlers } from '../mcp/handler.js'
import { mcpListReachable } from '../mcp/reachability.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import { withOwnSessionVocabulary } from './session-vocabulary.js'

/**
 * An injected `isFrameworkControlFlow` reaches every place an access question
 * is advertised: the Session vocabulary on every kind of context, MCP's
 * vocabulary and the admin's nav counts (#2421).
 */

const BOOT = 120_000

class SignedOut extends Error {}

const signal = new SignedOut('signed out')

let signalling = false

function gate(): boolean {
  if (signalling) throw signal
  return true
}

const capturedContexts = new Map<string, AccessContext>()

const signallingSpec = {
  ...text(),
  getFilterSpec: () => {
    if (signalling) throw signal
    return undefined
  },
}

function schemaConfig(isFrameworkControlFlow?: (thrown: unknown) => boolean): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    mcp: { enabled: true, basePath: '/api/mcp' },
    ...(isFrameworkControlFlow === undefined ? {} : { isFrameworkControlFlow }),
    lists: {
      Gated: {
        fields: {
          title: text({ access: { read: gate } }),
          spec: signallingSpec,
          shadow: virtual({
            type: 'string',
            hooks: {
              resolveOutput: ({ context }) => {
                capturedContexts.set('resolveOutput', context)
                return 'shadow'
              },
            },
          }),
        },
        access: {
          operation: { query: gate, create: () => true, update: () => true, delete: () => true },
        },
        hooks: {
          afterOperation: async ({ context }) => {
            capturedContexts.set('in-transaction hook', context)
          },
          afterTransaction: ({ context }) => {
            capturedContexts.set('afterTransaction', context)
          },
        },
        ui: { navCount: true },
      },
    },
  }
}

const isSignedOut = (thrown: unknown): boolean => thrown instanceof SignedOut

const author: Session = { userId: 'author-1' }

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase(schemaConfig(isSignedOut))
}, BOOT)

afterAll(async () => {
  await database?.close()
})

function injectedContext(session: Session | null = author): StackContext {
  return database.context(session)
}

function defaultContext(session: Session | null = author): StackContext {
  return getContext(
    schemaConfig(),
    ormClientFor(database.data, database.client.orm),
    session,
    undefined,
    false,
    undefined,
    undefined,
    database.client,
  )
}

const predicateFailure = new Error('predicate failed')

function throwingPredicateContext(session: Session | null = author): StackContext {
  return getContext(
    schemaConfig(() => {
      throw predicateFailure
    }),
    ormClientFor(database.data, database.client.orm),
    session,
    undefined,
    false,
    undefined,
    undefined,
    database.client,
  )
}

async function whileSignalling<T>(run: () => Promise<T>): Promise<T> {
  signalling = true
  try {
    return await run()
  } finally {
    signalling = false
  }
}

async function expectPropagated(context: AccessContext): Promise<void> {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  try {
    context._invalidateSessionVocabulary?.()
    await expect(
      whileSignalling(async () => await context._sessionVocabulary?.('Gated')),
    ).rejects.toBe(signal)
    expect(warn).not.toHaveBeenCalled()
  } finally {
    warn.mockRestore()
    context._invalidateSessionVocabulary?.()
  }
}

describe('the Session vocabulary', () => {
  test(
    'propagates what the injected predicate recognises on the root context',
    async () => {
      await expectPropagated(engineContextOf(injectedContext()))
    },
    BOOT,
  )

  test(
    'denies and logs the same throw when nothing is injected',
    async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const vocabulary = await whileSignalling(
          async () => await engineContextOf(defaultContext())._sessionVocabulary?.('Gated'),
        )
        expect(vocabulary?.operations.query).toBe('deny')
        expect(warn).toHaveBeenCalled()
      } finally {
        warn.mockRestore()
      }
    },
    BOOT,
  )

  test(
    'propagates through every question when only the config handed in carries the predicate',
    async () => {
      const { _config: _withoutOwnConfig, ...engine } = engineContextOf(injectedContext())
      const bare: AccessContext = { ...engine, _resolveOutputChain: [] }
      await expectPropagated(withOwnSessionVocabulary(bare, schemaConfig(isSignedOut)))
    },
    BOOT,
  )

  test(
    'denies and logs, without escaping, when the injected predicate throws',
    async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        const vocabulary = await whileSignalling(
          async () =>
            await engineContextOf(throwingPredicateContext())._sessionVocabulary?.('Gated'),
        )
        expect(vocabulary?.operations.query).toBe('deny')
        expect(warn).toHaveBeenCalled()
      } finally {
        warn.mockRestore()
        error.mockRestore()
      }
    },
    BOOT,
  )

  test(
    'propagates on sudo(), where only the filter spec can throw',
    async () => {
      await expectPropagated(engineContextOf(injectedContext().sudo()))
    },
    BOOT,
  )

  test(
    'propagates on withSession()',
    async () => {
      await expectPropagated(engineContextOf(injectedContext(null).withSession(author)))
    },
    BOOT,
  )

  test(
    'propagates on a transaction context',
    async () => {
      await injectedContext().transaction(async (tx) => {
        await expectPropagated(engineContextOf(tx))
      })
    },
    BOOT,
  )

  test(
    'propagates on the process-lifetime context',
    async () => {
      await expectPropagated(engineContextOf(processLifetimeContext(injectedContext())))
    },
    BOOT,
  )

  test(
    'propagates on a hook context, an afterTransaction context and a resolveOutput context',
    async () => {
      capturedContexts.clear()
      const context = injectedContext()
      const created = await context.db.Gated.create({ data: { title: 'first' } })
      expect(created).not.toBeNull()
      await context.db.Gated.all()
      for (const kind of ['in-transaction hook', 'afterTransaction', 'resolveOutput']) {
        const captured = capturedContexts.get(kind)
        expect(captured, kind).toBeDefined()
        if (captured !== undefined) await expectPropagated(captured)
      }
    },
    BOOT,
  )
})

describe('nav counts', () => {
  test(
    'propagate what the context’s injected predicate recognises, whatever config they are handed',
    async () => {
      await expect(
        whileSignalling(() => resolveNavCounts(engineContextOf(injectedContext()), schemaConfig())),
      ).rejects.toBe(signal)
    },
    BOOT,
  )

  test(
    'omit the badge and log, without escaping, when the injected predicate throws',
    async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const counts = await whileSignalling(() =>
          resolveNavCounts(engineContextOf(throwingPredicateContext()), schemaConfig()),
        )
        expect(counts).toEqual({})
        expect(error).toHaveBeenCalledWith(
          expect.stringContaining('isFrameworkControlFlow threw'),
          predicateFailure,
        )
      } finally {
        error.mockRestore()
        warn.mockRestore()
      }
    },
    BOOT,
  )

  test(
    'omit the badge and log when nothing is injected',
    async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const counts = await whileSignalling(() =>
          resolveNavCounts(engineContextOf(defaultContext()), schemaConfig()),
        )
        expect(counts).toEqual({})
      } finally {
        error.mockRestore()
        warn.mockRestore()
      }
    },
    BOOT,
  )
})

describe('MCP', () => {
  function toolsList(contextOf: (session?: Session) => StackContext) {
    const { POST } = createMcpHandlers({
      config: schemaConfig(),
      getSession: async () => ({
        userId: 'author-1',
        clientId: 'client-1',
        scopes: ['read', 'write'],
      }),
      getContext: async (session) => contextOf(session ?? undefined),
    })
    return POST(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    )
  }

  test(
    'reachability propagates what the context’s injected predicate recognises',
    async () => {
      await expect(
        whileSignalling(() =>
          mcpListReachable(schemaConfig(), 'Gated', engineContextOf(injectedContext()), {
            requireReadTool: true,
          }),
        ),
      ).rejects.toBe(signal)
    },
    BOOT,
  )

  test(
    'tools/list does not fold an injected control-flow throw into an omitted tool (the outer 500 is #2429)',
    async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const response = await whileSignalling(() => toolsList(() => injectedContext()))
        expect(response.status).toBe(500)
        expect(error).toHaveBeenCalledWith(expect.any(String), signal)
        expect(warn).not.toHaveBeenCalled()
      } finally {
        error.mockRestore()
        warn.mockRestore()
      }
    },
    BOOT,
  )

  test(
    'tools/list omits the tool and logs when nothing is injected',
    async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const response = await whileSignalling(() => toolsList(() => defaultContext()))
        expect(response.status).toBe(200)
        const body: { result: { tools: Array<{ name: string }> } } = JSON.parse(
          await response.text(),
        )
        expect(body.result.tools.map((tool) => tool.name)).not.toContain('list_gated_query')
        expect(warn).toHaveBeenCalled()
      } finally {
        warn.mockRestore()
      }
    },
    BOOT,
  )
})
