import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as z from 'zod'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { createMcpHandlers } from '../mcp/index.js'
import type { McpSession } from '../mcp/index.js'
import { createProcedureHandler } from '../procedures/http.js'
import { createProcedureBuilder, type ProcedureRegistry } from '../procedures/procedure.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import type { Actor } from './actor.js'
import type { AccessControlledDB, Session } from './types.js'

const BOOT = 120_000
const ORIGIN = 'http://app.test'

type Ctx = StackContext<AccessControlledDB>

let seen: Array<{ where: string; actor: Actor | undefined }> = []

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    mcp: { enabled: true },
    lists: {
      Entry: {
        fields: { label: text(), actorKind: text(), actorId: text(), onBehalfOf: text() },
        access: {
          operation: {
            query: () => true,
            create: ({ session }) => {
              seen.push({ where: 'rule', actor: session?.actor })
              return session?.actor?.kind === 'human' || session?.actor?.kind === 'agent'
            },
          },
        },
        hooks: {
          resolveInput: async ({ resolvedData, context }) => {
            const actor = context.session?.actor
            seen.push({ where: 'hook', actor })
            if (actor === undefined) return resolvedData
            return actor.kind === 'human'
              ? { ...resolvedData, actorKind: actor.kind, actorId: actor.userId }
              : {
                  ...resolvedData,
                  actorKind: actor.kind,
                  actorId: actor.clientId,
                  onBehalfOf: actor.onBehalfOf,
                }
          },
        },
        mcp: { tools: { create: true } },
      },
      HumanOnly: {
        fields: { label: text() },
        access: {
          operation: {
            query: () => true,
            create: ({ session }) => session?.actor?.kind === 'human',
          },
        },
        mcp: { tools: { create: true } },
      },
    },
  }
}

const procedure = createProcedureBuilder<Ctx>()

const whoAmI = procedure({
  description: 'Report the session the host built',
  input: z.object({}),
  output: z.object({
    signedIn: z.boolean(),
    userId: z.string().nullable(),
    actor: z.record(z.string(), z.string()).nullable(),
  }),
  access: () => true,
  expose: ['web'],
  run: ({ context }) => ({
    signedIn: context.session !== null,
    userId: context.session === null ? null : String(context.session.userId),
    actor: context.session?.actor === undefined ? null : { ...context.session.actor },
  }),
})

const addEntry = procedure({
  description: 'Add an entry stamped with whoever is acting',
  input: z.object({ label: z.string() }),
  output: z.object({ created: z.boolean() }),
  access: ({ session }) => {
    seen.push({ where: 'procedure', actor: session?.actor })
    return session?.actor?.kind === 'human'
  },
  expose: ['web'],
  run: async ({ input, context }) => ({
    created: (await context.db.Entry.create({ data: { label: input.label } })) !== null,
  }),
})

const registry: ProcedureRegistry<Ctx> = { whoAmI, addEntry }

describe('the actor on a host-built session', () => {
  let database: TestDatabase
  let built: Ctx | undefined
  const onUnexpectedError = vi.fn()

  const getContext = async (session?: Session | null): Promise<Ctx> => {
    built = database.context(session ?? null)
    return built
  }

  async function entries(): Promise<Array<Record<string, unknown>>> {
    return database.context().sudo().db.Entry.orderBy({ label: 'asc' }).all()
  }

  beforeAll(async () => {
    database = await createTestDatabase(schemaConfig())
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
    seen = []
    built = undefined
    onUnexpectedError.mockClear()
  })

  describe('the procedure HTTP host', () => {
    function web(resolved: unknown, name: string, body: unknown, cookie = true) {
      const resolveSession = vi.fn()
      resolveSession.mockResolvedValue(resolved)
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        origin: ORIGIN,
      }
      if (cookie) headers.cookie = 'session=ada'
      return createProcedureHandler<Ctx>({
        procedures: registry,
        getContext,
        getSession: resolveSession,
        allowedOrigins: [ORIGIN],
        onUnexpectedError,
      })(
        new Request(`${ORIGIN}/api/procedures/${name}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }),
      )
    }

    test('a web session carries a human actor with the user id', async () => {
      const response = await web({ userId: 'ada', role: 'editor' }, 'whoAmI', {})

      expect(await response.json()).toEqual({
        success: true,
        data: {
          signedIn: true,
          userId: 'ada',
          actor: { kind: 'human', userId: 'ada', via: 'web' },
        },
      })
      expect(built?.session).toMatchObject({ userId: 'ada', role: 'editor' })
    })

    test.each([
      ['an agent', { kind: 'agent', clientId: 'trusted', onBehalfOf: 'ada', via: 'mcp' }],
      ['another user', { kind: 'human', userId: 'grace', via: 'web' }],
      ['a made-up kind', { kind: 'system' }],
      ['a string', 'human'],
    ])('an actor of %s on what getSession resolves has no effect', async (_label, actor) => {
      const response = await web({ userId: 'ada', actor }, 'whoAmI', {})

      expect(await response.json()).toMatchObject({
        data: { actor: { kind: 'human', userId: 'ada', via: 'web' } },
      })
    })

    test('a session with no user id fails closed and is reported', async () => {
      for (const resolved of [{ role: 'editor' }, { userId: '' }, { userId: 7 }]) {
        onUnexpectedError.mockClear()
        const response = await web(resolved, 'whoAmI', {})

        expect(response.status).toBe(500)
        expect(await response.json()).toMatchObject({ error: { code: 'INTERNAL' } })
        expect(onUnexpectedError).toHaveBeenCalledOnce()
      }
      expect(built).toBeUndefined()
    })

    test('an anonymous caller is a null session, with no actor to read', async () => {
      const response = await web(null, 'whoAmI', {}, false)

      expect(await response.json()).toEqual({
        success: true,
        data: { signedIn: false, userId: null, actor: null },
      })
      expect(built?.session).toBeNull()

      const refused = await web(null, 'addEntry', { label: 'anonymous' }, false)
      expect(refused.status).toBe(401)
      expect(await entries()).toEqual([])
    })

    test('the actor is the same in the access rules, the hook and a transaction', async () => {
      const response = await web({ userId: 'ada' }, 'addEntry', { label: 'first' })
      expect(await response.json()).toEqual({ success: true, data: { created: true } })

      const context = built
      if (context === undefined) throw new Error('the host built no context')
      const inTransaction = await context.transaction(async (tx) => {
        await tx.db.Entry.create({ data: { label: 'second' } })
        return tx.session?.actor
      })

      const expected = { kind: 'human', userId: 'ada', via: 'web' }
      expect(inTransaction).toEqual(expected)
      expect(seen.map((entry) => entry.where)).toEqual([
        'procedure',
        'rule',
        'hook',
        'rule',
        'hook',
      ])
      for (const entry of seen) expect(entry.actor).toBe(inTransaction)
      expect(await entries()).toMatchObject([
        { label: 'first', actorKind: 'human', actorId: 'ada' },
        { label: 'second', actorKind: 'human', actorId: 'ada' },
      ])
    })
  })

  describe('the MCP host', () => {
    async function mcp(
      resolved: unknown,
      name: string,
      data: Record<string, unknown>,
    ): Promise<{ status: number; text: string }> {
      const resolveSession = vi.fn<() => Promise<McpSession | null>>()
      resolveSession.mockResolvedValue(z.custom<McpSession | null>().parse(resolved))
      const { POST } = createMcpHandlers({
        config: schemaConfig(),
        getSession: resolveSession,
        getContext,
      })
      const response = await POST(
        new Request('http://localhost/api/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name, arguments: { data } },
          }),
        }),
      )
      return { status: response.status, text: await response.text() }
    }

    test('an MCP session carries an agent actor and keeps the user id', async () => {
      const { status } = await mcp(
        { userId: 'ada', clientId: 'claude-desktop', role: 'editor', scopes: ['mcp:write'] },
        'list_entry_create',
        { label: 'from an agent' },
      )

      expect(status).toBe(200)
      expect(built?.session).toEqual({
        userId: 'ada',
        role: 'editor',
        actor: { kind: 'agent', clientId: 'claude-desktop', onBehalfOf: 'ada', via: 'mcp' },
      })
      expect(await entries()).toMatchObject([
        {
          label: 'from an agent',
          actorKind: 'agent',
          actorId: 'claude-desktop',
          onBehalfOf: 'ada',
        },
      ])
    })

    test.each([
      ['a human', { kind: 'human', userId: 'ada', via: 'web' }],
      ['another client', { kind: 'agent', clientId: 'trusted', onBehalfOf: 'grace', via: 'mcp' }],
    ])('an actor of %s from the session provider has no effect', async (_label, actor) => {
      await mcp({ userId: 'ada', clientId: 'claude-desktop', actor }, 'list_entry_create', {
        label: 'spoofed',
      })
      const denied = await mcp(
        { userId: 'ada', clientId: 'claude-desktop', actor },
        'list_human_only_create',
        { label: 'spoofed' },
      )

      expect(built?.session?.actor).toEqual({
        kind: 'agent',
        clientId: 'claude-desktop',
        onBehalfOf: 'ada',
        via: 'mcp',
      })
      expect(await entries()).toMatchObject([{ actorKind: 'agent', actorId: 'claude-desktop' }])
      expect(denied.text).not.toContain('"success":true')
      expect(await database.context().sudo().db.HumanOnly.all()).toEqual([])
    })

    test.each([
      ['no client id', { userId: 'ada' }],
      ['an empty client id', { userId: 'ada', clientId: '' }],
      ['a client id that is not a string', { userId: 'ada', clientId: 42 }],
      ['only an actor naming a client', { userId: 'ada', actor: { kind: 'agent', clientId: 'x' } }],
      ['no user id', { clientId: 'claude-desktop' }],
    ])('a session with %s is refused', async (_label, resolved) => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const { status, text } = await mcp(resolved, 'list_entry_create', { label: 'unverified' })

        expect(status).toBe(401)
        expect(text).toBe('')
        expect(logged).toHaveBeenCalledOnce()
      } finally {
        logged.mockRestore()
      }
      expect(built).toBeUndefined()
      expect(await entries()).toEqual([])
    })

    test('the actor is the same in the access rule, the hook and a transaction', async () => {
      await mcp({ userId: 'ada', clientId: 'claude-desktop' }, 'list_entry_create', {
        label: 'first',
      })

      const context = built
      if (context === undefined) throw new Error('the host built no context')
      const inTransaction = await context.transaction(async (tx) => {
        await tx.db.Entry.create({ data: { label: 'second' } })
        return tx.session?.actor
      })

      expect(inTransaction).toEqual({
        kind: 'agent',
        clientId: 'claude-desktop',
        onBehalfOf: 'ada',
        via: 'mcp',
      })
      expect(seen.length).toBeGreaterThanOrEqual(4)
      for (const entry of seen) expect(entry.actor).toBe(inTransaction)
      expect(await entries()).toMatchObject([
        { label: 'first', actorKind: 'agent', actorId: 'claude-desktop', onBehalfOf: 'ada' },
        { label: 'second', actorKind: 'agent', actorId: 'claude-desktop', onBehalfOf: 'ada' },
      ])
    })
  })

  test('a session no host built has no actor, and a rule asking for a human denies it', async () => {
    const context = database.context({ userId: 'ada' })

    expect(context.session?.actor).toBeUndefined()
    expect(await context.db.HumanOnly.create({ data: { label: 'no actor' } })).toBeNull()
    expect(await context.db.Entry.create({ data: { label: 'no actor' } })).toBeNull()
    expect(await entries()).toEqual([])
  })

  test('a host-built actor is frozen', async () => {
    const handler = createProcedureHandler<Ctx>({
      procedures: registry,
      getContext,
      getSession: async () => ({ userId: 'ada' }),
      allowedOrigins: [ORIGIN],
      onUnexpectedError,
    })
    await handler(
      new Request(`${ORIGIN}/api/procedures/whoAmI`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: 'session=ada' },
        body: '{}',
      }),
    )

    expect(Object.isFrozen(built?.session?.actor)).toBe(true)
  })
})
