import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { AccessContext, Session } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import { getContext } from '../context/index.js'
import { checkbox, relationship, text, virtual } from '../fields/index.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import { createMcpHandlers } from './handler.js'

const BOOT = 120_000

function noPrivateRows(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((row) => typeof row === 'object' && row !== null && row.public !== false)
  )
}

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  mcp: { enabled: true, basePath: '/api/mcp' },
  lists: {
    Ticket: {
      fields: {
        name: text(),
        notes: relationship({
          ref: 'Note.ticket',
          many: true,
          access: { read: ({ item }) => noPrivateRows(item.notes) },
        }),
        owner: text(),
        logs: relationship({
          ref: 'Log.ticket',
          many: true,
          access: { read: ({ item, session }) => item.owner === session?.userId },
        }),
        noteTotal: virtual({
          type: 'number',
          needs: ['notes'],
          hooks: {
            resolveOutput: ({ item }) => (Array.isArray(item.notes) ? item.notes.length : -1),
          },
        }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
    Note: {
      fields: {
        body: text(),
        public: checkbox(),
        ticket: relationship({ ref: 'Ticket.notes' }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
    Log: {
      fields: {
        body: text(),
        ticket: relationship({ ref: 'Ticket.logs' }),
        explodes: virtual({
          type: 'string',
          hooks: {
            resolveOutput: ({ context }) => {
              if (context.session !== null) throw new Error('a count computed the related list')
              return 'seeded'
            },
          },
        }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
  },
}

describe('a read rule on a relation counted over MCP', () => {
  let database: TestDatabase

  function contextFor(): (session?: Session) => Promise<AccessContext> {
    const orm = ormClientFor(database.data, database.client.orm)
    return async (given?: Session) => ({
      ...getContext(
        config,
        orm,
        given ?? null,
        undefined,
        false,
        undefined,
        undefined,
        database.client,
      ),
      ormHandle: orm,
      _resolveOutputChain: [],
    })
  }

  async function query(fields: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const handlers = createMcpHandlers({
      config,
      getSession: async () => ({ userId: 'user-123', scopes: ['read', 'write'] }),
      getContext: contextFor(),
    })
    const response = await handlers.POST(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'list_ticket_query',
            arguments: { orderBy: { name: 'asc' }, fields: { name: true, ...fields } },
          },
        }),
      }),
    )
    const { result } = JSON.parse(await response.text())
    if (result.isError) throw new Error(result.content[0].text)
    return JSON.parse(result.content[0].text).items
  }

  beforeAll(async () => {
    database = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
    const context = await contextFor()()
    for (const [name, secondIsPublic] of [
      ['all-public', true],
      ['mixed', false],
    ] as const) {
      const ticket = await context.db.Ticket.create({
        data: { name, owner: name === 'mixed' ? 'someone-else' : 'user-123' },
      })
      for (const body of ['one', 'two']) {
        await context.db.Log.create({ data: { body, ticket: { connect: { id: ticket?.id } } } })
      }
      await context.db.Note.create({
        data: { body: 'pub', public: true, ticket: { connect: { id: ticket?.id } } },
      })
      await context.db.Note.create({
        data: { body: 'other', public: secondIsPublic, ticket: { connect: { id: ticket?.id } } },
      })
    }
  })

  test(
    'take: 0 beside a count strips what the plain read strips',
    async () => {
      const plain = await query({ notes: { fields: { body: true } } })
      const counted = await query({ notes: { fields: { body: true }, take: 0, count: true } })

      expect(plain.map((row) => 'notes' in row)).toEqual([false, false])
      expect(counted).toEqual(plain)
    },
    BOOT,
  )

  test(
    'a where beside a count strips what the plain read strips',
    async () => {
      const where = { public: { equals: true } }
      const plain = await query({ notes: { fields: { body: true }, where } })
      const counted = await query({ notes: { fields: { body: true }, where, count: true } })

      expect(counted).toEqual(plain)
    },
    BOOT,
  )

  test.each([
    ['no paging', {}],
    ['take: 0', { take: 0 }],
    ['take: 1', { take: 1, orderBy: { body: 'desc' } }],
    ['skip past the rows', { skip: 9 }],
  ])(
    'a rule that reads its rows strips a count-only relation under %s',
    async (_, paging) => {
      const rows = await query({ notes: { count: true, ...paging } })

      expect(rows.map((row) => 'notes' in row)).toEqual([false, false])
    },
    BOOT,
  )

  test(
    'a rule that never reads the relation decides a count-only read as usual',
    async () => {
      const [own, others] = await query({ logs: { count: true, take: 0 } })

      expect(own).toHaveProperty('logs', 2)
      expect(others).not.toHaveProperty('logs')
    },
    BOOT,
  )

  test(
    'a count-only orderBy is checked whatever the relation rule reads',
    async () => {
      await expect(query({ notes: { count: true, orderBy: { nope: 'asc' } } })).rejects.toThrow(
        /nope/,
      )
    },
    BOOT,
  )

  test(
    'a narrowed count-only relation reveals no count',
    async () => {
      const rows = await query({ notes: { count: true, where: { public: { equals: true } } } })

      expect(rows.map((row) => 'notes' in row)).toEqual([false, false])
    },
    BOOT,
  )

  test(
    'declared rows decide a paged count for the ticket they clear',
    async () => {
      const [allPublic, mixed] = await query({
        noteTotal: true,
        notes: { fields: { body: true }, take: 0, count: true },
      })

      expect(allPublic).toMatchObject({ noteTotal: 2, notes: { items: [], count: 2 } })
      expect(mixed).toMatchObject({ noteTotal: 2 })
      expect(mixed).not.toHaveProperty('notes')
    },
    BOOT,
  )
})
