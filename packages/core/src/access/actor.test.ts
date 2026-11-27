import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as z from 'zod'
import type { OpenSaasConfig } from '../config/types.js'
import { text, virtual } from '../fields/index.js'
import { createMcpHandlers, mcpContextSession, McpSessionError } from '../mcp/index.js'
import type { McpSession } from '../mcp/index.js'
import { createProcedureHandler } from '../procedures/http.js'
import { createProcedureBuilder, type ProcedureRegistry } from '../procedures/procedure.js'
import { createServerCaller } from '../procedures/server.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import type { Actor } from './actor.js'
import type { AccessControlledDB, Session } from './types.js'

const BOOT = 120_000
const ORIGIN = 'http://app.test'

type Ctx = StackContext<AccessControlledDB>

let seen: Array<{ where: string; actor: Actor | undefined }> = []
let forgeries: Array<{ where: string; threw: boolean }> = []
let guardedRuleActors: Array<Actor | undefined> = []
let nestedCreates: Array<Record<string, unknown> | null> = []

const forgedSession: Session = {
  userId: 'ada',
  actor: { kind: 'human', userId: 'ada', via: 'web' },
}

function forge(where: string, context: { session: Session | null }): void {
  try {
    context.session = forgedSession
    forgeries.push({ where, threw: false })
  } catch (error) {
    forgeries.push({ where, threw: error instanceof TypeError })
  }
}

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
      NoAgents: {
        fields: { label: text() },
        access: {
          operation: {
            query: () => true,
            create: ({ session }) => session !== null && session.actor?.kind !== 'agent',
          },
        },
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
      Forger: {
        fields: {
          label: text(),
          guarded: text({
            access: {
              create: ({ session, context }) => {
                guardedRuleActors.push(session?.actor)
                forge('field rule', context)
                return context.session?.actor?.kind === 'human'
              },
            },
          }),
          shown: virtual({
            type: 'string',
            hooks: {
              resolveOutput: ({ context }) => {
                forge('resolveOutput', context)
                return 'shown'
              },
            },
          }),
        },
        access: { operation: { query: () => true, create: () => true } },
        hooks: {
          resolveInput: async ({ resolvedData, context }) => {
            forge('resolveInput', context)
            nestedCreates.push(await context.db.HumanOnly.create({ data: { label: 'nested' } }))
            return resolvedData
          },
          afterTransaction: async ({ context }) => {
            forge('afterTransaction', context)
          },
        },
      },
    },
  }
}

class ClassSession {
  [key: string]: unknown
  constructor(readonly userId: string) {}
  greeting(): string {
    return 'hello'
  }
}

class InheritedIdSession {
  get userId(): string {
    return 'ada'
  }
}

function storedUserId(session: Session | null): string | number | null {
  const userId = session?.userId
  return typeof userId === 'string' || typeof userId === 'number' ? userId : null
}

const procedure = createProcedureBuilder<Ctx>()

const whoAmI = procedure({
  description: 'Report the session the host built',
  input: z.object({}),
  output: z.object({
    signedIn: z.boolean(),
    userId: z.union([z.string(), z.number()]).nullable(),
    actor: z.record(z.string(), z.union([z.string(), z.number()])).nullable(),
    methods: z.boolean(),
  }),
  access: () => true,
  expose: ['web'],
  run: ({ context }) => ({
    signedIn: context.session !== null,
    userId: storedUserId(context.session),
    actor: context.session?.actor === undefined ? null : { ...context.session.actor },
    methods: context.session instanceof ClassSession && context.session.greeting() === 'hello',
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
    forgeries = []
    guardedRuleActors = []
    nestedCreates = []
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
          methods: false,
        },
      })
      expect(built?.session).toMatchObject({ userId: 'ada', role: 'editor' })
    })

    test('a numeric user id is carried on the actor as given', async () => {
      const response = await web({ userId: 7 }, 'whoAmI', {})

      expect(await response.json()).toMatchObject({
        success: true,
        data: { userId: 7, actor: { kind: 'human', userId: 7, via: 'web' } },
      })
      expect(built?.session?.actor).toEqual({ kind: 'human', userId: 7, via: 'web' })
    })

    test('a class-instance session keeps its own user id and its methods', async () => {
      const response = await web(new ClassSession('ada'), 'whoAmI', {})

      expect(await response.json()).toMatchObject({
        success: true,
        data: { userId: 'ada', actor: { kind: 'human', userId: 'ada', via: 'web' }, methods: true },
      })
    })

    test('a session whose user id is only inherited is refused, not passed on without one', async () => {
      const response = await web(new InheritedIdSession(), 'whoAmI', {})

      expect(response.status).toBe(500)
      expect(onUnexpectedError).toHaveBeenCalledOnce()
      expect(built).toBeUndefined()
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

    test('a session with no usable user id fails closed and the report names the fix', async () => {
      for (const resolved of [
        { role: 'editor' },
        { userId: '' },
        { userId: Number.NaN },
        { userId: null },
        { userId: { id: 'ada' } },
      ]) {
        onUnexpectedError.mockClear()
        const response = await web(resolved, 'whoAmI', {})

        expect(response.status).toBe(500)
        const body = await response.text()
        expect(JSON.parse(body)).toMatchObject({ error: { code: 'INTERNAL' } })
        expect(body).not.toContain('sessionFields')
        expect(onUnexpectedError).toHaveBeenCalledOnce()
        const [reported] = onUnexpectedError.mock.calls[0] ?? []
        expect(reported).toBeInstanceOf(Error)
        expect(String(reported)).toContain('no usable `userId`')
        expect(String(reported)).toContain('authPlugin({ sessionFields })')
      }
      expect(built).toBeUndefined()
    })

    test('an anonymous caller is a null session, with no actor to read', async () => {
      const response = await web(null, 'whoAmI', {}, false)

      expect(await response.json()).toEqual({
        success: true,
        data: { signedIn: false, userId: null, actor: null, methods: false },
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
    async function rpc(
      resolved: unknown,
      method: string,
      params?: Record<string, unknown>,
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
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        }),
      )
      return { status: response.status, text: await response.text() }
    }

    const mcp = (resolved: unknown, name: string, data: Record<string, unknown>) =>
      rpc(resolved, 'tools/call', { name, arguments: { data } })

    const toolResult = z.object({
      result: z.object({
        isError: z.boolean().optional(),
        content: z.array(z.object({ text: z.string() })),
      }),
    })

    const toolList = z.object({
      result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
    })

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
      const provided = { userId: 'ada', clientId: 'claude-desktop', actor }
      const listed = toolList.parse(JSON.parse((await rpc(provided, 'tools/list')).text))
      const denied = await mcp(provided, 'list_humanOnly_create', { label: 'spoofed' })

      expect(built?.session?.actor).toEqual({
        kind: 'agent',
        clientId: 'claude-desktop',
        onBehalfOf: 'ada',
        via: 'mcp',
      })
      expect(await entries()).toMatchObject([{ actorKind: 'agent', actorId: 'claude-desktop' }])
      const names = listed.result.tools.map((tool) => tool.name)
      expect(names).toContain('list_entry_create')
      expect(names).not.toContain('list_humanOnly_create')
      expect(denied.status).toBe(200)
      const refusal = toolResult.parse(JSON.parse(denied.text)).result
      expect(refusal.isError).toBe(true)
      expect(refusal.content[0]?.text).toBe(
        'Failed to create record. Access denied or validation failed.',
      )
      expect(await database.context().sudo().db.HumanOnly.all()).toEqual([])
    })

    test.each([
      ['no client id', { userId: 'ada' }, 'clientId'],
      ['an empty client id', { userId: 'ada', clientId: '' }, 'clientId'],
      ['a client id that is not a string', { userId: 'ada', clientId: 42 }, 'clientId'],
      [
        'only an actor naming a client',
        { userId: 'ada', actor: { kind: 'agent', clientId: 'x' } },
        'clientId',
      ],
      ['no user id', { clientId: 'claude-desktop' }, 'userId'],
      ['an empty user id', { userId: '', clientId: 'claude-desktop' }, 'userId'],
      ['a numeric user id', { userId: 7, clientId: 'claude-desktop' }, 'userId'],
    ])(
      'a session with %s is a server misconfiguration: 500, and the log names the field',
      async (_label, resolved, field) => {
        const other = field === 'clientId' ? 'userId' : 'clientId'
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
          const response = await mcp(resolved, 'list_entry_create', { label: 'unverified' })

          expect(response.status).toBe(500)
          expect(response.text).not.toContain(field)
          expect(logged).toHaveBeenCalledOnce()
          const line = String(logged.mock.calls[0]?.[0])
          expect(line).toContain(`no usable \`${field}\``)
          expect(line).not.toContain(`no usable \`${other}\``)
        } finally {
          logged.mockRestore()
        }
        expect(built).toBeUndefined()
        expect(await entries()).toEqual([])
      },
    )

    test('no session at all is still 401 with the challenge', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const { status, text } = await mcp(null, 'list_entry_create', { label: 'anonymous' })

        expect(status).toBe(401)
        expect(text).toBe('')
        expect(logged).not.toHaveBeenCalled()
      } finally {
        logged.mockRestore()
      }
      expect(built).toBeUndefined()
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

  describe('a context built from a verified MCP session outside the handler', () => {
    const verified: McpSession = {
      userId: 'ada',
      clientId: 'claude-desktop',
      role: 'editor',
      scopes: ['mcp:write'],
      accessToken: 'token',
      actor: { kind: 'human', userId: 'ada', via: 'web' },
    }

    test('carries the agent actor the handler sets, and a rule that denies agents denies it', async () => {
      const context = database.context(mcpContextSession(verified))

      expect(context.session).toEqual({
        userId: 'ada',
        role: 'editor',
        actor: { kind: 'agent', clientId: 'claude-desktop', onBehalfOf: 'ada', via: 'mcp' },
      })
      expect(await context.db.NoAgents.create({ data: { label: 'agent' } })).toBeNull()
      expect(await context.db.HumanOnly.create({ data: { label: 'agent' } })).toBeNull()
      expect(await context.db.Entry.create({ data: { label: 'agent' } })).toMatchObject({
        actorKind: 'agent',
        actorId: 'claude-desktop',
      })

      const signedIn = database.context({ userId: 'ada' })
      expect(await signedIn.db.NoAgents.create({ data: { label: 'person' } })).not.toBeNull()
    })

    test.each([
      ['no client id', { userId: 'ada' }, ['clientId']],
      ['no user id', { clientId: 'claude-desktop' }, ['userId']],
      ['neither', {}, ['clientId', 'userId']],
      ['a numeric user id', { userId: 7, clientId: 'claude-desktop' }, ['userId']],
    ])('a session with %s is refused', (_label, session, missing) => {
      const build = () => mcpContextSession(z.custom<McpSession>().parse(session))

      expect(build).toThrow(McpSessionError)
      expect(build).toThrow(expect.objectContaining({ missing }))
    })
  })

  describe('an actor no host minted', () => {
    const forgedHuman = { kind: 'human', userId: 'ada', via: 'web' } as const
    const forged: Session = { userId: 'ada', actor: forgedHuman }

    test('is absent in access rules and hooks, through getContext and withSession', async () => {
      const direct = database.context(forged)
      const substituted = database.context().withSession(forged)
      const elevated = database.context(forged).sudo()

      for (const context of [direct, substituted]) {
        expect(context.session).toEqual({ userId: 'ada' })
        expect(context.session !== null && 'actor' in context.session).toBe(false)
        expect(await context.db.HumanOnly.create({ data: { label: 'forged' } })).toBeNull()
        expect(await context.db.Entry.create({ data: { label: 'forged' } })).toBeNull()
        expect(
          await context.transaction((tx) => tx.db.HumanOnly.create({ data: { label: 'forged' } })),
        ).toBeNull()
      }
      expect(seen.map((entry) => entry.actor)).toEqual([undefined, undefined])

      seen = []
      expect(elevated.session?.actor).toBeUndefined()
      await elevated.db.Entry.create({ data: { label: 'elevated' } })
      expect(seen).toEqual([{ where: 'hook', actor: undefined }])
      expect(await entries()).toMatchObject([{ label: 'elevated', actorKind: null }])
      expect(await database.context().sudo().db.HumanOnly.all()).toEqual([])
      expect(forged.actor).toBe(forgedHuman)
    })

    test.each([
      ['a frozen session', () => Object.freeze({ userId: 'ada', actor: forgedHuman })],
      [
        'a copy of a minted actor',
        () => ({
          userId: 'ada',
          actor: { ...mcpContextSession({ userId: 'ada', clientId: 'c' }).actor },
        }),
      ],
      [
        'an accessor',
        () =>
          Object.defineProperty({ userId: 'ada' }, 'actor', {
            get: () => mcpContextSession({ userId: 'ada', clientId: 'c' }).actor,
            enumerable: true,
          }),
      ],
      [
        'a prototype',
        () => Object.create({ actor: forgedHuman }, { userId: { value: 'ada', enumerable: true } }),
      ],
    ])('is absent when it arrives on %s', (_label, build) => {
      const context = database.context(z.custom<Session>().parse(build()))

      expect(context.session?.userId).toBe('ada')
      expect(context.session?.actor).toBeUndefined()
    })
  })

  describe('a host-minted actor', () => {
    test('survives into rules, hooks, nested transactions, sudo() and withSession', async () => {
      const session = mcpContextSession({ userId: 'ada', clientId: 'claude-desktop' })
      const context = database.context(session)
      const minted = session.actor

      const nested = await context.transaction(async (tx) => {
        await tx.db.Entry.create({ data: { label: 'outer' } })
        return tx.transaction(async (inner) => {
          await inner.sudo().db.Entry.create({ data: { label: 'inner sudo' } })
          return [tx.session?.actor, inner.session?.actor, inner.sudo().session?.actor]
        })
      })

      expect(context.session?.actor).toBe(minted)
      expect(context.sudo().session?.actor).toBe(minted)
      expect(database.context().withSession(context.session).session?.actor).toBe(minted)
      for (const actor of nested) expect(actor).toBe(minted)
      expect(seen.map((entry) => entry.where)).toEqual(['rule', 'hook', 'hook'])
      for (const entry of seen) expect(entry.actor).toBe(minted)
      expect(await entries()).toMatchObject([
        { label: 'inner sudo', actorKind: 'agent', actorId: 'claude-desktop' },
        { label: 'outer', actorKind: 'agent', actorId: 'claude-desktop' },
      ])
    })

    test('belongs to the session it was minted for and is dropped on any other', async () => {
      const contextAs = (userId: string | number) =>
        createServerCaller({
          procedures: registry,
          getContext: async (session?: Session) => database.context(session),
          getSession: async () => ({ userId }),
        }).context()
      const ada = await contextAs('ada')
      const human = ada.session?.actor
      const numeric = (await contextAs(5)).session?.actor
      const agent = mcpContextSession({ userId: 'ada', clientId: 'claude-desktop' }).actor
      if (human === undefined || agent === undefined || numeric === undefined) {
        throw new Error('expected minted actors')
      }

      expect(database.context({ userId: 'ada', actor: human }).session?.actor).toBe(human)
      expect(database.context({ userId: 'ada', actor: agent }).session?.actor).toBe(agent)
      expect(database.context().withSession(ada.session).session?.actor).toBe(human)

      for (const session of [
        { userId: 'victim', actor: human },
        { userId: 'victim', actor: agent },
        { actor: human },
        { userId: '5', actor: numeric },
        Object.assign(Object.create({ userId: 'ada' }), { actor: human }),
      ]) {
        const context = database.context(session)
        expect(context.session?.actor).toBeUndefined()
        expect(context.withSession(context.session).session?.actor).toBeUndefined()
        expect(await context.db.HumanOnly.create({ data: { label: 'stolen' } })).toBeNull()
      }
    })

    test('cannot be swapped, added or edited on a context session', async () => {
      const agent = database.context(mcpContextSession({ userId: 'ada', clientId: 'c' }))
      const plain = database.context({ userId: 'ada' })
      const human = { kind: 'human', userId: 'ada', via: 'web' } as const

      for (const context of [agent, plain, agent.sudo(), plain.withSession({ userId: 'ada' })]) {
        const session = context.session
        if (session === null) throw new Error('expected a session')
        const before = session.actor
        expect(() => {
          session.actor = human
        }).toThrow(TypeError)
        expect(() => Object.defineProperty(session, 'actor', { value: human })).toThrow(TypeError)
        expect(() => {
          context.session = { userId: 'ada', actor: human }
        }).toThrow(TypeError)
        expect(context.session).toBe(session)
        expect(session.actor).toBe(before)
        expect(
          await database.context(session).db.HumanOnly.create({ data: { label: 'x' } }),
        ).toBeNull()
      }
      expect(Reflect.set(agent.session?.actor ?? {}, 'kind', 'human')).toBe(false)
      expect(agent.session?.actor?.kind).toBe('agent')
      expect(Object.isFrozen(agent.session?.actor)).toBe(true)
    })

    test('cannot be forged by a hook, a field rule or resolveOutput rebinding context.session', async () => {
      const context = database.context({ userId: 'ada' })

      await expect(
        context.db.Forger.create({ data: { label: 'guarded', guarded: 'g' } }),
      ).rejects.toThrow('Cannot create "guarded": field-level access denied')
      const stored = await context.db.Forger.create({ data: { label: 'stored' } })
      const read = await context.db.Forger.where({ label: { equals: 'stored' } }).first()

      expect(stored).toMatchObject({ label: 'stored', shown: 'shown' })
      expect(read).toMatchObject({ label: 'stored', shown: 'shown' })
      expect(new Set(forgeries.map((entry) => entry.where))).toEqual(
        new Set(['resolveInput', 'field rule', 'resolveOutput', 'afterTransaction']),
      )
      for (const entry of forgeries) expect(entry).toEqual({ where: entry.where, threw: true })
      expect(guardedRuleActors).toEqual([undefined])
      expect(nestedCreates).toEqual([null, null])
      expect(await database.context().sudo().db.HumanOnly.all()).toEqual([])
      expect(context.session?.actor).toBeUndefined()
    })

    test('cannot be forged by rebinding tx.session inside a transaction', async () => {
      const context = database.context({ userId: 'ada' })

      await context.transaction(async (tx) => {
        forge('tx', tx)
        forge('tx.sudo()', tx.sudo())
        forge('tx.withSession()', tx.withSession({ userId: 'ada' }))
        await tx.transaction(async (inner) => {
          forge('nested tx', inner)
        })
        await tx.db.Forger.create({ data: { label: 'in tx' } })
        expect(tx.session?.actor).toBeUndefined()
      })

      expect(forgeries.map((entry) => entry.where)).toEqual([
        'tx',
        'tx.sudo()',
        'tx.withSession()',
        'nested tx',
        'resolveInput',
        'resolveOutput',
        'afterTransaction',
      ])
      for (const entry of forgeries) expect(entry).toEqual({ where: entry.where, threw: true })
      expect(nestedCreates).toEqual([null])
      expect(await database.context().sudo().db.HumanOnly.all()).toEqual([])
    })

    test('leaves the session object the caller passed as it was', () => {
      const given: Session = { userId: 'ada', actor: { kind: 'human', userId: 'ada', via: 'web' } }
      const context = database.context(given)

      expect(Object.isFrozen(given)).toBe(false)
      expect(given.actor).toEqual({ kind: 'human', userId: 'ada', via: 'web' })
      expect(Object.isFrozen(context.session)).toBe(true)
    })
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
