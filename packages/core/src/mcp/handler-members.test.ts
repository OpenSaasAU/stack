import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { AccessContext, Session } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import { getContext } from '../context/index.js'
import type { McpSessionProvider } from './types.js'
import { createMcpHandlers } from './handler.js'

const BOOT = 120_000

const open = { query: () => true, create: () => true, update: () => true, delete: () => true }

function membersConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    mcp: { enabled: true, basePath: '/api/mcp' },
    lists: {
      Citizen: {
        fields: {
          name: text(),
          passport: relationship({ ref: 'Passport.citizen' }),
        },
        db: { idField: 'int autoincrement' },
        access: { operation: open },
      },
      Passport: {
        fields: {
          code: text(),
          citizen: relationship({ ref: 'Citizen.passport', db: { foreignKey: true } }),
          office: relationship({ ref: 'Office' }),
        },
        access: { operation: open },
      },
      Office: {
        fields: { name: text() },
        access: { operation: open },
        mcp: { enabled: false },
      },
      Visa: {
        fields: { holder: relationship({ ref: 'Citizen' }) },
        access: { operation: open },
        mcp: { enabled: false },
      },
    },
  }
}

type ToolResult = { isError?: boolean; content: Array<{ text: string }> }
type Tool = { name: string; inputSchema: { properties: Record<string, { properties: object }> } }

describe('MCP over the List member resolver', () => {
  let database: TestDatabase
  const config = membersConfig()
  const session: McpSessionProvider = async () => ({ userId: 'u1', scopes: ['read', 'write'] })

  beforeAll(async () => {
    database = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
  })

  async function contextOf(given?: Session): Promise<AccessContext> {
    const orm = ormClientFor(database.data, database.client.orm)
    return {
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
    }
  }

  async function rpc(method: string, params?: unknown): Promise<Record<string, unknown>> {
    const handlers = createMcpHandlers({ config, getSession: session, getContext: contextOf })
    const response = await handlers.POST(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
    )
    return JSON.parse(await response.text())
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const body = await rpc('tools/call', { name, arguments: args })
    return body.result as ToolResult
  }

  async function writeSchema(tool: string): Promise<Record<string, unknown>> {
    const body = await rpc('tools/list')
    const tools = (body.result as { tools: Tool[] }).tools
    const found = tools.find((candidate) => candidate.name === tool)
    return found?.inputSchema.properties.data.properties as Record<string, unknown>
  }

  test(
    'a non-owning one-to-one and a relation into an unreachable list are left out of the write schema',
    async () => {
      for (const tool of ['list_citizen_create', 'list_citizen_update']) {
        const data = await writeSchema(tool)
        expect(data.name).toBeDefined()
        expect(data.passport).toBeUndefined()
      }
      const passport = await writeSchema('list_passport_create')
      expect(passport.citizen).toMatchObject({
        properties: { connect: { properties: { id: { type: 'integer' } } } },
      })
      expect(passport.office).toBeUndefined()
    },
    BOOT,
  )

  test(
    'a non-owning one-to-one in data passes to the write pipeline, which refuses it as context.db does',
    async () => {
      const result = await callTool('list_citizen_create', {
        data: { name: 'a', passport: { connect: { id: '0190f3a2-7b1c-7d2e-8f3a-1b2c3d4e5f60' } } },
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).not.toContain('has no field')

      const context = await contextOf()
      await expect(
        context.db.Citizen.create({
          data: {
            name: 'a',
            passport: { connect: { id: '0190f3a2-7b1c-7d2e-8f3a-1b2c3d4e5f60' } },
          },
        }),
      ).rejects.toThrow()
    },
    BOOT,
  )

  test(
    'a relation into an unreachable list is refused as an unknown field on write',
    async () => {
      const result = await callTool('list_passport_create', {
        data: { code: 'p', office: { connect: { id: '0190f3a2-7b1c-7d2e-8f3a-1b2c3d4e5f60' } } },
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('"Passport" has no field "office"')
    },
    BOOT,
  )

  test(
    "connect.id is coerced to the related list's integer id",
    async () => {
      const context = await contextOf()
      const citizen = await context.db.Citizen.create({ data: { name: 'c' } })
      expect(typeof citizen?.id).toBe('number')

      const created = await callTool('list_passport_create', {
        data: { code: 'p', citizen: { connect: { id: String(citizen?.id) } } },
      })
      expect(created.isError).toBeFalsy()
      expect(JSON.parse(created.content[0].text)).toMatchObject({
        success: true,
        item: { code: 'p', citizenId: citizen?.id },
      })

      const malformed = await callTool('list_passport_create', {
        data: { code: 'q', citizen: { connect: { id: 'not-an-int' } } },
      })
      expect(malformed.isError).toBe(true)
      expect(malformed.content[0].text).toBe(
        'Failed to create record. Access denied or validation failed.',
      )
    },
    BOOT,
  )

  test(
    'a Synthetic back-relation in a where is refused as an unknown key',
    async () => {
      const result = await callTool('list_citizen_query', {
        where: { from_Visa_holder: { some: { holderId: 1 } } },
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain(
        '"from_Visa_holder" is not a queryable field of this list',
      )
    },
    BOOT,
  )
})

describe('createMcpHandlers', () => {
  test("throws generate's own refusal at startup for a config generate refuses", () => {
    const refused: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      mcp: { enabled: true },
      lists: {
        Tag: { fields: { notes: relationship({ ref: 'Note.tags', many: true }) } },
        Note: { fields: { tags: relationship({ ref: 'Tag.notes', many: true }) } },
      },
    }
    const getContext = async (): Promise<AccessContext> => {
      throw new Error('never reached')
    }
    expect(() =>
      createMcpHandlers({ config: refused, getSession: async () => null, getContext }),
    ).toThrow(/many/i)
  })
})
