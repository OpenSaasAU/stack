import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { Session } from '../access/types.js'
import { integer, relationship, text, virtual } from '../fields/index.js'
import { withOrigin } from '../origin.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { createPlanRecorder, type RecordedPlan } from '../testing/plans.js'
import { ValidationError } from '../hooks/index.js'

const BOOT = 120_000

let ada: Session = {}

/**
 * A fixture with one shape per rule `.select()` has to honour: a computed
 * field declaring a stored column, one declaring a read-denied column, one
 * declaring a relation, a computed field on the related list (so a
 * declared-only branch has something that must NOT run), and a field whose
 * `read` rule reaches into the row.
 */
const shopConfig: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    User: {
      fields: {
        handle: text({ validation: { isRequired: true } }),
        orders: relationship({ ref: 'Order.buyer', many: true }),
        // Declares a relation, so reading a User widens the read by `orders`
        // and strips the branch back out.
        orderCount: virtual({
          type: 'string',
          needs: ['orders'],
          hooks: {
            resolveOutput: ({ item }) => String((item.orders as unknown[] | undefined)?.length),
          },
        }),
      },
      access: { operation: { query: () => true } },
    },
    Order: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        note: text(),
        // Read-denied to the caller, and declared by `masked` below.
        cardLast4: text({ access: { read: () => false } }),
        buyer: relationship({ ref: 'User.orders' }),
        lines: relationship({ ref: 'Line.order', many: true }),
        // Declares a stored column the caller need never name.
        shout: virtual({
          type: 'string',
          needs: ['title'],
          hooks: { resolveOutput: ({ item }) => `${String(item.title)}!` },
        }),
        // Declares a column a `read` rule denies the caller.
        masked: virtual({
          type: 'string',
          needs: ['cardLast4'],
          hooks: { resolveOutput: ({ item }) => `••••${String(item.cardLast4)}` },
        }),
        // Declares a relation: the fold the new terminals used to skip.
        total: virtual({
          type: 'number',
          needs: ['lines'],
          hooks: {
            resolveOutput: ({ item }) =>
              ((item.lines ?? []) as { price: number }[]).reduce(
                (sum, line) => sum + line.price,
                0,
              ),
          },
        }),
        // Reports exactly what its own `item` carried.
        keys: virtual({
          type: 'string',
          needs: ['note'],
          hooks: { resolveOutput: ({ item }) => Object.keys(item).sort().join(',') },
        }),
      },
      access: { operation: { query: () => true } },
    },
    Line: {
      fields: {
        price: integer(),
        order: relationship({ ref: 'Order.lines' }),
        // A computed field on a list only ever reached through a declaration.
        doubled: virtual({
          type: 'number',
          needs: ['price'],
          hooks: { resolveOutput: ({ item }) => Number(item.price) * 2 },
        }),
      },
      access: { operation: { query: () => true } },
    },
    // A list whose `read` rule has to see a row, so the projection cannot
    // narrow the query.
    Ticket: {
      fields: {
        subject: text({ validation: { isRequired: true } }),
        open: text(),
        detail: text({ access: { read: ({ item }) => item?.open === 'yes' } }),
      },
      access: { operation: { query: () => true } },
    },
    // Denied by default: Silent failure must survive a projection.
    Vault: {
      fields: { code: text({ validation: { isRequired: true } }) },
    },
  },
}

const recorder = createPlanRecorder()
let database: TestDatabase

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function collection(model: string): Record<string, unknown> {
  const namespace: unknown = Reflect.get(database.client.orm, 'public')
  if (!isRecord(namespace)) throw new Error('no public namespace')
  const found: unknown = Reflect.get(namespace, model)
  if (!isRecord(found)) throw new Error(`no collection "${model}"`)
  return found
}

/** Seed through the Unsafe origin: writes are another spec's, and the read must not depend on them. */
function seed(model: string, row: object): Promise<Record<string, unknown>> {
  const target = collection(model)
  const create: unknown = target.create
  if (typeof create !== 'function') throw new Error(`collection "${model}" has no create`)
  return withOrigin('unsafe', async () => {
    const created: unknown = await create.call(target, row)
    if (!isRecord(created)) throw new Error('create returned no row')
    return created
  })
}

/** Every column the recorded plan projects, in the alias the decoder reads it back under. */
function projectedColumns(plan: RecordedPlan | undefined): string[] {
  const ast: unknown = plan?.ast
  if (!isRecord(ast)) return []
  const projection: unknown = ast.projection
  if (!Array.isArray(projection)) return []
  return projection
    .map((item) => (isRecord(item) && typeof item.alias === 'string' ? item.alias : ''))
    .filter((alias) => alias !== '')
    .sort()
}

async function seedShop(): Promise<void> {
  const user = await seed('User', { handle: 'ada' })
  ada = { userId: user.id }
  const order = await seed('Order', {
    title: 'a crate of punchcards',
    note: 'leave at the door',
    cardLast4: '4242',
    buyer: user.id,
  })
  await seed('Line', { price: 3, order: order.id })
  await seed('Line', { price: 4, order: order.id })
  await seed('Ticket', { subject: 'open one', open: 'yes', detail: 'visible' })
  await seed('Ticket', { subject: 'shut one', open: 'no', detail: 'hidden' })
}

beforeAll(async () => {
  database = await createTestDatabase(shopConfig, { middleware: [recorder.middleware] })
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  await database.truncate()
  await seedShop()
  recorder.clear()
})

describe('Projection', () => {
  test(
    'a read selecting only a computed field returns it, and the widened columns it was computed from are not in the result',
    async () => {
      const rows = await database.context(ada).db.Order.select('shout').all()

      // The query asked for `title` — the declared dependency of `shout` —
      // and did not ask for `note` or `cardLast4`, which nothing needed.
      expect(projectedColumns(recorder.plans[0])).toEqual(['createdAt', 'id', 'title', 'updatedAt'])
      expect(rows[0].shout).toBe('a crate of punchcards!')
      // …and the widening is invisible to the caller.
      expect(rows[0]).not.toHaveProperty('title')
      expect(rows[0]).not.toHaveProperty('note')
    },
    BOOT,
  )

  test(
    'the assertion is falsifiable: the same read without a projection carries the columns',
    async () => {
      const rows = await database.context(ada).db.Order.all()

      expect(projectedColumns(recorder.plans[0])).toContain('note')
      expect(rows[0].title).toBe('a crate of punchcards')
    },
    BOOT,
  )

  test(
    'the result matches the selection exactly, whatever the caller names',
    async () => {
      const rows = await database.context(ada).db.Order.select('note').all()

      expect(rows[0].note).toBe('leave at the door')
      expect(rows[0]).not.toHaveProperty('shout')
      expect(rows[0]).not.toHaveProperty('title')
    },
    BOOT,
  )

  test(
    'select() replaces rather than accumulates',
    async () => {
      const rows = await database.context(ada).db.Order.select('title').select('note').all()

      expect(rows[0].note).toBe('leave at the door')
      expect(rows[0]).not.toHaveProperty('title')
    },
    BOOT,
  )

  test(
    'an include is not narrowed by select(): the two compose',
    async () => {
      const rows = await database.context(ada).db.Order.select('shout').include('buyer').all()

      expect(rows[0].shout).toBe('a crate of punchcards!')
      expect(rows[0].buyer).toMatchObject({ handle: 'ada' })
    },
    BOOT,
  )

  test(
    'the strip is recursive: a relation the widening added under a caller-named branch does not survive',
    async () => {
      const rows = await database.context(ada).db.Order.include('buyer').all()

      // `User.orderCount` declares `orders`, so the widening fetched it one
      // level down. It reached the hook and left the caller's result.
      const buyer = rows[0].buyer
      expect(isRecord(buyer) && buyer.orderCount).toBe('1')
      expect(isRecord(buyer) && 'orders' in buyer).toBe(false)
    },
    BOOT,
  )

  test(
    'a refinement carries its own projection, and it is honoured exactly',
    async () => {
      const rows = await database
        .context(ada)
        .db.Order.select('title')
        .include('lines', (lines) => lines.select('doubled'))
        .all()

      const lines = rows[0].lines
      expect(Array.isArray(lines)).toBe(true)
      const [line] = lines as Record<string, unknown>[]
      expect(line.doubled).toBe(6)
      expect(line).not.toHaveProperty('price')
    },
    BOOT,
  )

  test(
    'a projection naming a key the list does not declare is refused',
    async () => {
      await expect(database.context(ada).db.Order.select('nonsense').all()).rejects.toThrow(
        ValidationError,
      )
    },
    BOOT,
  )

  test(
    'a projection naming a relation is refused, and the message names include()',
    async () => {
      await expect(database.context(ada).db.Order.select('lines').all()).rejects.toThrow(
        /include\("lines"\)/,
      )
    },
    BOOT,
  )
})

describe('Field Visibility', () => {
  test(
    'a read rule that has to see a row is answered against one: the query is not narrowed, the result still is',
    async () => {
      const rows = await database.context(ada).db.Ticket.select('detail').all()

      // The rule reaches into `item`, so the widening declines to project.
      expect(projectedColumns(recorder.plans[0])).toContain('open')
      const details = rows.map((row) => row.detail)
      expect(details.filter((detail) => detail !== undefined)).toEqual(['visible'])
      expect(details).toHaveLength(2)
      // And the column the rule read is still the engine's, not the caller's.
      for (const row of rows) expect(row).not.toHaveProperty('open')
    },
    BOOT,
  )

  test(
    'a read-denied column stays denied when the caller selects it',
    async () => {
      const rows = await database.context(ada).db.Order.select('cardLast4', 'note').all()

      expect(rows[0].note).toBe('leave at the door')
      expect(rows[0]).not.toHaveProperty('cardLast4')
    },
    BOOT,
  )
})

describe('Declared dependency set', () => {
  test(
    "a resolveOutput sees its declared columns and the list's system fields, and nothing the caller selected",
    async () => {
      const rows = await database.context(ada).db.Order.select('keys', 'title').all()

      // `keys` declares `note` alone. `title` is on the row because the
      // CALLER asked for it, and is invisible to the hook regardless — a
      // field cannot compute differently because of another call site.
      expect(rows[0].keys).toBe('createdAt,id,note,updatedAt')
    },
    BOOT,
  )

  test(
    'the same hook sees the same item when the caller selects nothing at all',
    async () => {
      const rows = await database.context(ada).db.Order.all()

      expect(rows[0].keys).toBe('createdAt,id,note,updatedAt')
    },
    BOOT,
  )

  test(
    'a column with a read denial declared in needs reaches the hook and is absent from the result',
    async () => {
      const rows = await database.context(ada).db.Order.select('masked').all()

      // The declaration outranks the caller-facing denial…
      expect(rows[0].masked).toBe('••••4242')
      // …and the column itself still never reaches the caller.
      expect(rows[0]).not.toHaveProperty('cardLast4')
      expect(JSON.stringify(rows[0])).not.toContain('"4242"')
    },
    BOOT,
  )

  test(
    'a relation-valued needs is folded into the widened read on the new terminals',
    async () => {
      const rows = await database.context(ada).db.Order.select('total').all()

      expect(rows[0].total).toBe(7)
      expect(rows[0]).not.toHaveProperty('lines')
    },
    BOOT,
  )

  test(
    'the widened read reaches the same rows the caller would have got by naming the relation',
    async () => {
      const context = database.context(ada)
      const [widened] = await context.db.Order.all()
      const [named] = await context.db.Order.include('lines').all()

      const sum = (named.lines as { price: number }[]).reduce(
        (running, line) => running + line.price,
        0,
      )
      expect(widened.total).toBe(sum)
      expect(widened.total).toBe(7)
    },
    BOOT,
  )

  test(
    'a computed field on a declared-only branch does not run',
    async () => {
      // `Line.doubled` would compute if the branch were the caller's. It is
      // not: only `Order.total`'s declaration asked for it.
      const rows = await database.context(ada).db.Order.select('total').all()
      expect(rows[0].total).toBe(7)

      const named = await database
        .context(ada)
        .db.Order.include('lines', (lines) => lines.orderBy({ price: 'asc' }))
        .all()
      const lines = named[0].lines as Record<string, unknown>[]
      // Named by the caller, so it DOES compute — which is what makes the
      // assertion above about the declared branch rather than about the field.
      expect(lines.map((line) => line.doubled)).toEqual([6, 8])
    },
    BOOT,
  )
})

describe('Bare read', () => {
  test(
    'a read that projects nothing anywhere asks for no projection at all',
    async () => {
      await database.context(ada).db.Ticket.all()

      const columns = projectedColumns(recorder.plans[0])
      expect(columns).toContain('detail')
      expect(columns).toContain('subject')
    },
    BOOT,
  )
})

describe('Silent failure', () => {
  test(
    'a denied read is denied before the projection can say anything about the list',
    async () => {
      const context = database.context(ada)

      expect(await context.db.Vault.select('code').all()).toEqual([])
      expect(await context.db.Vault.select('code').first()).toBeNull()
      expect(recorder.plans).toEqual([])
    },
    BOOT,
  )
})
