import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import postgres from '@prisma/orm-postgres/runtime'
import type { AccessContext, Session } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import type { PrismaContract } from '../contract/prisma.js'
import { getContext } from '../context/index.js'
import { checkbox, integer, relationship, text, virtual } from '../fields/index.js'
import { createMcpHandlers } from '../mcp/handler.js'
import { originTripwire } from '../origin.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import { ESCAPE_VARIABLES, readDatabaseEscape } from '../testing/escape.js'
import { createPlanRecorder } from '../testing/plans.js'

const BOOT = 120_000
const open = { query: () => true, create: () => true, update: () => true, delete: () => true }

interface Line {
  price: number
  quantity: number
}

function isLine(value: unknown): value is Line {
  return typeof value === 'object' && value !== null && 'price' in value && 'quantity' in value
}

function linesOf(value: unknown): Line[] {
  if (!Array.isArray(value)) throw new TypeError('the declared relation is not an array')
  return value.filter(isLine)
}

function sum(lines: readonly Line[]): number {
  return lines.reduce((total, line) => total + line.price * line.quantity, 0)
}

function nameOf(value: unknown): string | null {
  return typeof value === 'object' && value !== null && 'name' in value ? String(value.name) : null
}

const hookRuns: string[] = []

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  mcp: { enabled: true, basePath: '/api/mcp' },
  lists: {
    Customer: {
      fields: {
        name: text(),
        orders: relationship({ ref: 'Order.customer', many: true }),
      },
      access: { operation: open },
    },
    Order: {
      fields: {
        ref: text(),
        customer: relationship({ ref: 'Customer.orders' }),
        lineItems: relationship({ ref: 'LineItem.order', many: true }),
        total: virtual({
          type: 'number',
          needs: ['lineItems'],
          hooks: { resolveOutput: ({ item }) => sum(linesOf(item.lineItems)) },
        }),
        buyer: virtual({
          type: 'string',
          needs: ['customer'],
          hooks: { resolveOutput: ({ item }) => nameOf(item.customer) ?? 'nobody' },
        }),
        summary: text({
          needs: ['lineItems'],
          hooks: {
            resolveOutput: ({ value, item }) =>
              `${String(value)}:${linesOf(item.lineItems).length}`,
          },
        }),
      },
      access: { operation: open },
      hooks: {
        afterOperation: async (args) => {
          if (args.operation !== 'create' || args.item.ref !== 'seeded') return
          await args.context.db.LineItem.create({
            data: { price: 7, quantity: 2, order: { connect: { id: args.item.id } } },
          })
        },
      },
    },
    LineItem: {
      fields: {
        price: integer(),
        quantity: integer(),
        hidden: checkbox(),
        order: relationship({ ref: 'Order.lineItems', db: { onDelete: 'cascade' } }),
      },
      access: {
        operation: {
          ...open,
          query: ({ session }: { session: Session | null }) =>
            session?.role === 'staff' ? true : { hidden: { equals: false } },
        },
      },
    },
    Vault: {
      fields: {
        label: text(),
        coins: relationship({ ref: 'Coin.vault', many: true }),
        hoard: virtual({
          type: 'number',
          needs: ['coins'],
          hooks: {
            resolveOutput: ({ item }) => {
              hookRuns.push('hoard')
              if (!Array.isArray(item.coins)) throw new TypeError('item.coins is not an array')
              return item.coins.length
            },
          },
        }),
      },
      access: {
        operation: {
          ...open,
          query: ({ session }: { session: Session | null }) =>
            session === null ? false : { label: { equals: String(session.userId) } },
        },
      },
    },
    Sealed: {
      fields: {
        name: text(),
        seals: relationship({ ref: 'Seal.sealed', many: true }),
        tally: virtual({
          type: 'number',
          needs: ['seals'],
          hooks: {
            resolveOutput: ({ item }) => {
              hookRuns.push('tally')
              return Array.isArray(item.seals) ? item.seals.length : -1
            },
          },
        }),
      },
      access: { operation: { ...open, query: () => false } },
    },
    Seal: {
      fields: { sealed: relationship({ ref: 'Sealed.seals', db: { onDelete: 'cascade' } }) },
      access: { operation: open },
    },
    Coin: {
      fields: { vault: relationship({ ref: 'Vault.coins', db: { onDelete: 'cascade' } }) },
      access: { operation: { ...open, query: () => false } },
    },
    Shelf: {
      fields: {
        name: text(),
        books: relationship({ ref: 'Book.shelf', many: true, access: { read: () => false } }),
        count: virtual({
          type: 'number',
          needs: ['books'],
          hooks: { resolveOutput: ({ item }) => linesOf(item.books).length },
        }),
      },
      access: { operation: open },
    },
    Book: {
      fields: {
        price: integer(),
        quantity: integer(),
        shelf: relationship({ ref: 'Shelf.books' }),
      },
      access: { operation: open },
    },
    Crate: {
      fields: {
        name: text(),
        slats: relationship({ ref: 'Slat.crate', many: true }),
        weight: virtual({
          type: 'number',
          needs: ['slats'],
          hooks: { resolveOutput: ({ item }) => sum(linesOf(item.slats)) },
        }),
      },
      access: { operation: open },
      hooks: {
        beforeOperation: async (args) => {
          if (args.operation !== 'delete') return
          const slats = await args.context.db.Slat.where({
            crateId: { equals: args.item.id },
          }).all()
          for (const slat of slats) await args.context.db.Slat.delete({ where: { id: slat.id } })
        },
      },
    },
    Slat: {
      fields: {
        price: integer(),
        quantity: integer(),
        crate: relationship({ ref: 'Crate.slats' }),
      },
      access: { operation: open },
    },
    Tripwire: {
      fields: {
        name: text(),
        parts: relationship({ ref: 'Part.tripwire', many: true }),
        loud: virtual({
          type: 'number',
          needs: ['parts'],
          hooks: {
            resolveOutput: ({ item }) => {
              if (linesOf(item.parts).length > 0) throw new Error('the computed field blew up')
              return 0
            },
          },
        }),
      },
      access: { operation: open },
      hooks: {
        afterOperation: async (args) => {
          if (args.operation !== 'create' || args.item.name !== 'boom') return
          await args.context.db.Part.create({
            data: { price: 1, quantity: 1, tripwire: { connect: { id: args.item.id } } },
          })
        },
      },
    },
    Part: {
      fields: {
        price: integer(),
        quantity: integer(),
        tripwire: relationship({ ref: 'Tripwire.parts' }),
      },
      access: { operation: open },
    },
    Plain: {
      fields: {
        title: text(),
        shout: virtual({
          type: 'string',
          needs: ['title'],
          hooks: { resolveOutput: ({ item }) => String(item.title).toUpperCase() },
        }),
        twigs: relationship({ ref: 'Twig.plain', many: true }),
      },
      access: { operation: open },
    },
    Twig: {
      fields: { plain: relationship({ ref: 'Plain.twigs' }) },
      access: { operation: open },
    },
  },
}

type TestContext = ReturnType<TestDatabase['context']>

function idOf(row: Record<string, unknown> | null): string {
  if (row === null || typeof row.id !== 'string') throw new Error('expected a row with an id')
  return row.id
}

async function addLines(context: TestContext, orderId: string): Promise<void> {
  const order = { connect: { id: orderId } }
  await context.db.LineItem.create({ data: { price: 5, quantity: 3, hidden: false, order } })
  await context.db.LineItem.create({ data: { price: 4, quantity: 2, hidden: false, order } })
  await context.db.LineItem.create({ data: { price: 100, quantity: 1, hidden: true, order } })
}

async function firstOrder(context: TestContext, id: string): Promise<Record<string, unknown>> {
  const row = await context.db.Order.where({ id: { equals: id } }).first()
  if (row === null) throw new Error('expected the order to be readable')
  return row
}

describe('a write returns a needs: [relation] field exactly as a read of that row does', () => {
  const recorder = createPlanRecorder()
  let database: TestDatabase
  let staff: TestContext
  let customer: TestContext

  beforeAll(async () => {
    database = await createTestDatabase(config, { middleware: [recorder.middleware] })
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
    hookRuns.length = 0
    staff = database.context({ userId: 'u1', role: 'staff' })
    customer = database.context({ userId: 'u1', role: 'customer' })
  })

  async function order(): Promise<string> {
    const id = idOf(await staff.db.Order.create({ data: { ref: 'a', summary: 's' } }))
    await addLines(staff, id)
    return id
  }

  test('the documented Order.total creates, updates and deletes', async () => {
    const created = await staff.db.Order.create({ data: { ref: 'a', summary: 's' } })
    expect(created).toMatchObject({ ref: 'a', total: 0, buyer: 'nobody', summary: 's:0' })

    const id = idOf(created)
    await addLines(staff, id)

    const updated = await staff.db.Order.update({ where: { id }, data: { ref: 'b' } })
    expect(updated).toMatchObject({ ref: 'b', total: 123, summary: 's:3' })

    const deleted = await staff.db.Order.delete({ where: { id } })
    expect(deleted).toMatchObject({ ref: 'b', total: 123, summary: 's:3' })
    expect(await staff.db.Order.where({ id: { equals: id } }).first()).toBeNull()
  })

  test('create agrees with first(), to-one and to-many, over rows its own hook wrote', async () => {
    const owner = idOf(await staff.db.Customer.create({ data: { name: 'Ada' } }))
    const created = await staff.db.Order.create({
      data: { ref: 'seeded', summary: 's', customer: { connect: { id: owner } } },
    })

    expect(created).toMatchObject({ total: 14, buyer: 'Ada', summary: 's:1' })
    expect(created).toEqual(await firstOrder(staff, idOf(created)))
  })

  test('update agrees with first(), to-one and to-many', async () => {
    const id = await order()
    const owner = idOf(await staff.db.Customer.create({ data: { name: 'Ada' } }))
    const updated = await staff.db.Order.update({
      where: { id },
      data: { customer: { connect: { id: owner } } },
    })

    expect(updated).toMatchObject({ total: 123, buyer: 'Ada', summary: 's:3' })
    expect(updated).toEqual(await firstOrder(staff, id))
  })

  test('an update with an empty payload still returns the computed value', async () => {
    const id = await order()
    const updated = await staff.db.Order.update({ where: { id }, data: {} })

    expect(updated).toMatchObject({ total: 123 })
    expect(updated).toEqual(await firstOrder(staff, id))
  })

  test('delete returns what first() gave the row just before it went', async () => {
    const id = await order()
    const owner = idOf(await staff.db.Customer.create({ data: { name: 'Ada' } }))
    await staff.db.Order.update({ where: { id }, data: { customer: { connect: { id: owner } } } })
    const before = await firstOrder(staff, id)

    const deleted = await staff.db.Order.delete({ where: { id } })

    expect(before).toMatchObject({ total: 123, buyer: 'Ada' })
    expect(deleted).toEqual(before)
  })

  test('delete computes over the children a beforeOperation hook clears', async () => {
    const id = idOf(await staff.db.Crate.create({ data: { name: 'c' } }))
    await staff.db.Slat.create({ data: { price: 6, quantity: 7, crate: { connect: { id } } } })
    const before = await staff.db.Crate.where({ id: { equals: id } }).first()

    const deleted = await staff.db.Crate.delete({ where: { id } })

    expect(before).toMatchObject({ weight: 42 })
    expect(deleted).toEqual(before)
    expect(await staff.db.Slat.all()).toEqual([])
  })

  test('the relation a needs fetched never reaches the caller of a write', async () => {
    const id = await order()
    const updated = await staff.db.Order.update({ where: { id }, data: { ref: 'b' } })
    const deleted = await staff.db.Order.delete({ where: { id } })

    expect(updated).not.toHaveProperty('lineItems')
    expect(deleted).not.toHaveProperty('lineItems')
  })

  test('.forUpdate() and all() agree with the write inside one transaction', async () => {
    const id = await order()
    await staff.transaction(async (tx) => {
      const updated = await tx.db.Order.update({ where: { id }, data: { ref: 'b' } })
      await tx.db.LineItem.create({
        data: { price: 1000, quantity: 1, order: { connect: { id } } },
      })
      const again = await tx.db.Order.update({ where: { id }, data: { ref: 'c' } })
      const locked = await tx.db.Order.where({ id: { equals: id } })
        .forUpdate()
        .first()
      const every = await tx.db.Order.where({ id: { equals: id } }).all()

      expect(updated).toMatchObject({ total: 123 })
      expect(again).toMatchObject({ total: 1123 })
      expect(locked).toEqual(again)
      expect(every).toEqual([again])
    })
  })

  test('a delete inside a transaction sees that transaction’s own rows', async () => {
    const id = await order()
    const deleted = await staff.transaction(async (tx) => {
      await tx.db.LineItem.create({
        data: { price: 1000, quantity: 1, order: { connect: { id } } },
      })
      return await tx.db.Order.delete({ where: { id } })
    })

    expect(deleted).toMatchObject({ total: 1123 })
  })

  test('a rolled-back transaction’s rows do not outlive it', async () => {
    const id = await order()
    await expect(
      staff.transaction(async (tx) => {
        await tx.db.LineItem.create({
          data: { price: 1000, quantity: 1, order: { connect: { id } } },
        })
        const updated = await tx.db.Order.update({ where: { id }, data: { ref: 'b' } })
        expect(updated).toMatchObject({ total: 1123 })
        throw new Error('roll back')
      }),
    ).rejects.toThrow('roll back')

    expect(await staff.db.Order.update({ where: { id }, data: {} })).toMatchObject({
      ref: 'a',
      total: 123,
    })
  })

  test('the value is session-relative: rows the session cannot query are not counted', async () => {
    const id = await order()

    const asCustomer = await customer.db.Order.update({ where: { id }, data: { ref: 'b' } })
    expect(asCustomer).toMatchObject({ total: 23, summary: 's:2' })
    expect(asCustomer).toEqual(await firstOrder(customer, id))

    const asStaff = await staff.db.Order.update({ where: { id }, data: { ref: 'c' } })
    expect(asStaff).toMatchObject({ total: 123, summary: 's:3' })

    const deleted = await customer.db.Order.delete({ where: { id } })
    expect(deleted).toMatchObject({ total: 23 })
  })

  test('sudo() sees what a sudo read sees', async () => {
    const id = await order()
    const sudo = customer.sudo()

    const updated = await sudo.db.Order.update({ where: { id }, data: { ref: 'b' } })
    expect(updated).toMatchObject({ total: 123 })
    expect(updated).toEqual(await sudo.db.Order.where({ id: { equals: id } }).first())

    expect(await sudo.db.Order.delete({ where: { id } })).toMatchObject({ total: 123 })
  })

  test('a dependency on a list the session cannot query computes over nothing', async () => {
    const owner = database.context({ userId: 'mine' })
    const id = idOf(await owner.db.Vault.create({ data: { label: 'mine' } }))
    await owner.sudo().db.Coin.create({ data: { vault: { connect: { id } } } })

    const updated = await owner.db.Vault.update({ where: { id }, data: {} })
    expect(updated).toMatchObject({ hoard: 0 })
    expect(updated).toEqual(await owner.db.Vault.where({ id: { equals: id } }).first())

    expect(await owner.sudo().db.Vault.update({ where: { id }, data: {} })).toMatchObject({
      hoard: 1,
    })
    expect(await owner.db.Vault.delete({ where: { id } })).toMatchObject({ hoard: 0 })
  })

  test('a row the session cannot query comes back as its system fields, computing nothing', async () => {
    const stranger = database.context({ userId: 'stranger' })

    const created = await stranger.db.Vault.create({ data: { label: 'someone-else' } })
    const id = idOf(created)
    expect(created).toEqual({ id })

    await stranger.sudo().db.Coin.create({ data: { vault: { connect: { id } } } })
    hookRuns.length = 0

    expect(await stranger.db.Vault.update({ where: { id }, data: {} })).toEqual({ id })
    expect(await stranger.db.Vault.delete({ where: { id } })).toEqual({ id })
    expect(hookRuns).toEqual([])
  })

  test('a list the session may never query returns its system fields, computing nothing', async () => {
    const created = await staff.db.Sealed.create({ data: { name: 'a' } })
    const id = idOf(created)
    await staff.sudo().db.Seal.create({ data: { sealed: { connect: { id } } } })

    const updated = await staff.db.Sealed.update({ where: { id }, data: { name: 'b' } })
    const deleted = await staff.db.Sealed.delete({ where: { id } })

    expect({ created, updated, deleted }).toEqual({
      created: { id },
      updated: { id },
      deleted: { id },
    })
    expect(hookRuns).toEqual([])
  })

  test('an update that moves the row out of the session’s scope reads as that', async () => {
    const owner = database.context({ userId: 'mine' })
    const id = idOf(await owner.db.Vault.create({ data: { label: 'mine' } }))

    expect(await owner.db.Vault.update({ where: { id }, data: { label: 'gone' } })).toEqual({ id })
  })

  test('a declared relation reaches the hook on a write even when its read is denied', async () => {
    const id = idOf(await staff.db.Shelf.create({ data: { name: 'top' } }))
    await staff.db.Book.create({ data: { price: 1, quantity: 1, shelf: { connect: { id } } } })

    const updated = await staff.db.Shelf.update({ where: { id }, data: { name: 'low' } })

    expect(updated).toMatchObject({ count: 1 })
    expect(updated).not.toHaveProperty('books')
    expect(updated).toEqual(await staff.db.Shelf.where({ id: { equals: id } }).first())
  })

  test('a computed field that really throws rejects the write and rolls it back', async () => {
    await expect(staff.db.Tripwire.create({ data: { name: 'boom' } })).rejects.toThrow(
      'the computed field blew up',
    )

    expect(await staff.db.Tripwire.all()).toEqual([])
    expect(await staff.db.Part.all()).toEqual([])
  })

  describe('what the re-read costs', () => {
    function kinds(): string[] {
      return recorder.plans.map((plan) => plan.kind)
    }

    async function planKinds(write: () => Promise<unknown>): Promise<string[]> {
      recorder.clear()
      await write()
      return kinds()
    }

    test('a list with no relation in needs takes exactly the path it always did', async () => {
      let id = ''
      const created = await planKinds(async () => {
        id = idOf(await staff.db.Plain.create({ data: { title: 'a' } }))
      })
      const updated = await planKinds(() =>
        staff.db.Plain.update({ where: { id }, data: { title: 'b' } }),
      )
      const deleted = await planKinds(() => staff.db.Plain.delete({ where: { id } }))

      expect({ created, updated, deleted }).toEqual({
        created: ['insert'],
        updated: ['select', 'raw-query', 'select', 'select', 'update'],
        deleted: ['select', 'raw-query', 'select', 'select', 'delete'],
      })
    })

    test('a list that declares one pays one read per write', async () => {
      let id = ''
      const created = await planKinds(async () => {
        id = idOf(await staff.db.Order.create({ data: { ref: 'a', summary: 's' } }))
      })
      const updated = await planKinds(() =>
        staff.db.Order.update({ where: { id }, data: { ref: 'b' } }),
      )
      const deleted = await planKinds(() => staff.db.Order.delete({ where: { id } }))

      expect({ created, updated, deleted }).toEqual({
        created: ['insert', 'select'],
        updated: ['select', 'raw-query', 'select', 'select', 'update', 'select'],
        deleted: ['select', 'raw-query', 'select', 'select', 'select', 'delete'],
      })
    })
  })

  describe('over MCP', () => {
    async function contextFor(session?: Session): Promise<AccessContext> {
      const orm = ormClientFor(database.data, database.client.orm)
      return {
        ...getContext(
          config,
          orm,
          session ?? null,
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

    async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
      const handlers = createMcpHandlers({
        config,
        getSession: async () => ({ userId: 'user-123', role: 'staff', scopes: ['read', 'write'] }),
        getContext: contextFor,
      })
      const response = await handlers.POST(
        new Request('http://localhost/api/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name, arguments: args },
          }),
        }),
      )
      const { result } = JSON.parse(await response.text())
      if (result.isError) throw new Error(result.content[0].text)
      return JSON.parse(result.content[0].text)
    }

    test('create, update and delete all answer with the computed total', async () => {
      const created = await call('list_order_create', { data: { ref: 'mcp', summary: 's' } })
      expect(created).toMatchObject({ item: { ref: 'mcp', total: 0 } })

      const orders = await staff.db.Order.all()
      const id = idOf(orders[0])
      await addLines(staff, id)

      const updated = await call('list_order_update', { where: { id }, data: { ref: 'x' } })
      expect(updated).toMatchObject({ item: { ref: 'x', total: 123 } })

      expect(await call('list_order_delete', { where: { id } })).toEqual({
        success: true,
        deletedId: id,
      })
      expect(await staff.db.Order.all()).toEqual([])
    })
  })
})

const escape = readDatabaseEscape()

describe.skipIf(escape.kind !== 'postgres')(
  escape.kind === 'postgres'
    ? 'the re-read on a single-connection pool'
    : `the re-read on a single-connection pool [escape-only: ${ESCAPE_VARIABLES.join('/')} names no Postgres]`,
  () => {
    let database: TestDatabase
    let close: () => Promise<void> = async () => {}
    let context: TestContext

    beforeAll(async () => {
      database = await createTestDatabase(config)
      const client = postgres<PrismaContract>({
        contract: database.contract,
        pg: new pg.Pool({ connectionString: database.url, max: 1 }),
        verifyMarker: false,
        middleware: [originTripwire],
      })
      close = () => client.close()
      const orm = ormClientFor(database.data, client.orm)
      context = getContext(
        config,
        orm,
        { userId: 'u1', role: 'staff' },
        undefined,
        false,
        undefined,
        undefined,
        client,
      )
    }, BOOT)

    afterAll(async () => {
      await close()
      await database?.close()
    })

    test('create, update and delete finish without asking the pool for a second connection', async () => {
      const created = await context.db.Order.create({ data: { ref: 'seeded', summary: 's' } })
      const id = idOf(created)
      expect(created).toMatchObject({ total: 14 })
      expect(await context.db.Order.update({ where: { id }, data: {} })).toMatchObject({
        total: 14,
      })
      expect(await context.db.Order.delete({ where: { id } })).toMatchObject({ total: 14 })
    }, 20_000)
  },
)
