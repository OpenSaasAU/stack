import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text, virtual } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

/**
 * Regression coverage for issue #1243: a to-one's foreign-key column used to
 * leak the related row's id whenever the read never named the relation at
 * all — `applyForeignKeys` (the #1235 fix) only ever narrows a column for a
 * relation present in the resolved include tree, so a bare read had nothing
 * narrowing it. `narrowUnincludedForeignKeys` (`read.ts`) is what this file
 * exercises: every scenario below reads with NO `.include()` at all.
 */
const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Region: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        orgs: relationship({ ref: 'Org.region', many: true }),
      },
      access: { operation: { query: () => false } },
    },
    Org: {
      fields: {
        handle: text({ validation: { isRequired: true } }),
        items: relationship({ ref: 'Item.owner', many: true }),
        region: relationship({ ref: 'Region.orgs' }),
      },
      access: {
        operation: {
          query: ({ session }) =>
            typeof session?.handle !== 'string' ? false : { handle: { equals: session.handle } },
        },
      },
    },
    Item: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        owner: relationship({ ref: 'Org.items' }),
        secret: relationship({
          ref: 'Org',
          access: { read: () => false },
        }),
        renamed: relationship({ ref: 'Org', db: { foreignKey: { map: 'org_ref' } } }),
      },
      access: { operation: { query: () => true, create: () => true, update: () => true } },
    },
  },
}

let database: TestDatabase
let mineId: string
let othersId: string
let itemMineId: string
let itemOthersId: string

beforeAll(async () => {
  database = await createTestDatabase(config)
  const sudo = database.context(null).sudo()
  const region = await sudo.db.Region.create({ data: { name: 'north' } })
  if (!region) throw new Error('seed region')
  const mine = await sudo.db.Org.create({
    data: { handle: 'mine', region: { connect: { id: region.id } } },
  })
  const others = await sudo.db.Org.create({ data: { handle: 'others' } })
  if (!mine || !others) throw new Error('seed orgs')
  mineId = String(mine.id)
  othersId = String(others.id)

  const itemMine = await sudo.db.Item.create({
    data: {
      title: 'mine-item',
      owner: { connect: { id: mineId } },
      secret: { connect: { id: mineId } },
      renamed: { connect: { id: mineId } },
    },
  })
  const itemOthers = await sudo.db.Item.create({
    data: {
      title: 'others-item',
      owner: { connect: { id: othersId } },
      secret: { connect: { id: othersId } },
      renamed: { connect: { id: othersId } },
    },
  })
  if (!itemMine || !itemOthers) throw new Error('seed items')
  itemMineId = String(itemMine.id)
  itemOthersId = String(itemOthers.id)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

describe('a bare read (no include) narrows an operation-level-filtered to-one', () => {
  test(
    'keeps the foreign key when the related row satisfies the filter',
    async () => {
      const asMine = database.context({ handle: 'mine' })
      const item = await asMine.db.Item.where({ id: { equals: itemMineId } }).first()
      expect(item?.owner).toBeUndefined()
      expect(item?.ownerId).toBe(mineId)
    },
    BOOT,
  )

  test(
    'nulls the foreign key when the related row does not satisfy the filter',
    async () => {
      const asMine = database.context({ handle: 'mine' })
      const item = await asMine.db.Item.where({ id: { equals: itemOthersId } }).first()
      expect(item?.owner).toBeUndefined()
      expect(item?.ownerId).toBeNull()
    },
    BOOT,
  )

  test(
    'nulls the foreign key outright for a session the related list denies entirely',
    async () => {
      const anonymous = database.context(null)
      const item = await anonymous.db.Item.where({ id: { equals: itemMineId } }).first()
      expect(item?.ownerId).toBeNull()
    },
    BOOT,
  )

  test(
    'holds across a page of bare reads the same way it holds for one row',
    async () => {
      const asMine = database.context({ handle: 'mine' })
      const page = await asMine.db.Item.orderBy({ title: 'asc' }).all()
      expect(page.map((row) => row.title)).toEqual(['mine-item', 'others-item'])
      expect(page.map((row) => row.ownerId)).toEqual([mineId, null])
    },
    BOOT,
  )
})

describe('a bare read narrows a to-one whose own field-level read rule denies it', () => {
  test(
    'nulls the foreign key regardless of the related row or session',
    async () => {
      const asMine = database.context({ handle: 'mine' })
      const item = await asMine.db.Item.where({ id: { equals: itemMineId } }).first()
      expect(item?.secret).toBeUndefined()
      expect(item?.secretId).toBeNull()
    },
    BOOT,
  )
})

describe('an included relation still narrows ITS OWN un-included to-one', () => {
  test(
    'nulls the nested foreign key while the included relation itself stays visible',
    async () => {
      const asMine = database.context({ handle: 'mine' })
      const item = await asMine.db.Item.where({ id: { equals: itemMineId } })
        .include('owner')
        .first()
      const owner = item?.owner as Record<string, unknown> | null | undefined
      expect(owner?.handle).toBe('mine')
      expect(owner?.regionId).toBeNull()
    },
    BOOT,
  )
})

describe('a bare read narrows a to-one whose foreign-key column is renamed', () => {
  test(
    'holds the same visibility under db.foreignKey.map as the unrenamed column',
    async () => {
      const asMine = database.context({ handle: 'mine' })
      const visible = await asMine.db.Item.where({ id: { equals: itemMineId } }).first()
      expect(visible?.renamedId).toBe(mineId)

      const notVisible = await asMine.db.Item.where({ id: { equals: itemOthersId } }).first()
      expect(notVisible?.renamedId).toBeNull()
    },
    BOOT,
  )
})

/**
 * Regression coverage for issue #1386, item 2: `narrowUnincludedForeignKeys`'s
 * companion existence check cannot tell "the row is gone" from "the row is
 * denied" — both come back absent from it, and the code deliberately folds
 * them into the same `null`. PGlite serialises every statement, so a real
 * concurrent delete never lands inside the window between the main read and
 * the companion check; this forces the window instead, by giving the
 * relationship field's own `read` rule a side effect that deletes the related
 * row. That rule runs once per row, strictly before the companion query
 * (`narrowUnincludedForeignKeys`'s own ordering — see `read.ts`), which is
 * what makes the deletion land inside the window on every run rather than
 * racing it.
 */
describe('a related row deleted between the main read and the companion existence check', () => {
  test(
    'nulls the foreign key instead of leaking the id read before the row vanished',
    async () => {
      // Declared before `config` and assigned after: the closure below only
      // runs later, during the read the test issues, by which point `scratch`
      // is assigned. An access control function's own `context` argument is
      // `AccessContext` — it has no `sudo()` of its own — so the side effect
      // reaches an elevated context through this fixture instead.
      let scratch: TestDatabase
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql' },
        lists: {
          Org: {
            fields: { handle: text({ validation: { isRequired: true } }) },
            // A Where-vocabulary filter, not a boolean — a boolean answer
            // short-circuits `narrowUnincludedForeignKeys` before it ever
            // issues the companion existence check this test targets.
            access: { operation: { query: () => ({ handle: { contains: '' } }) } },
          },
          Item: {
            fields: {
              title: text({ validation: { isRequired: true } }),
              owner: relationship({
                ref: 'Org',
                // `setNull` so the delete below is a plain FK-constrained
                // write rather than one this schema refuses outright.
                db: { onDelete: 'setNull' },
                access: {
                  // Runs once per row, before the companion existence check
                  // (read.ts's own ordering) — deletes the related row out
                  // from under the read this session already issued.
                  read: async ({ item }) => {
                    const ownerId = item?.ownerId
                    if (typeof ownerId === 'string') {
                      await scratch
                        .context(null)
                        .sudo()
                        .db.Org.delete({ where: { id: ownerId } })
                    }
                    return true
                  },
                },
              }),
            },
            access: { operation: { query: () => true } },
          },
        },
      }
      scratch = await createTestDatabase(config)
      try {
        const sudo = scratch.context(null).sudo()
        const org = await sudo.db.Org.create({ data: { handle: 'will-vanish' } })
        if (!org) throw new Error('seed org')
        const orgId = String(org.id)
        const item = await sudo.db.Item.create({
          data: { title: 'orphaned-mid-read', owner: { connect: { id: orgId } } },
        })
        if (!item) throw new Error('seed item')
        const itemId = String(item.id)

        const read = await scratch
          .context(null)
          .db.Item.where({ id: { equals: itemId } })
          .first()
        expect(read?.ownerId).toBeNull()

        const stillThere = await sudo.db.Org.where({ id: { equals: orgId } }).first()
        expect(stillThere).toBeNull()
      } finally {
        await scratch.close()
      }
    },
    BOOT,
  )
})

describe('a computed field that needs a to-one does not null its foreign key', () => {
  const needsConfig: OpenSaasConfig = {
    db: { provider: 'postgresql' },
    lists: {
      Person: {
        fields: { handle: text({ validation: { isRequired: true } }) },
        access: {
          operation: { query: ({ session }) => session?.handle === 'reader' },
        },
      },
      Order: {
        fields: {
          ref: text({ validation: { isRequired: true } }),
          customer: relationship({ ref: 'Person' }),
          customerName: virtual({
            type: 'string',
            needs: ['customer'],
            hooks: {
              resolveOutput: ({ item }) => {
                const customer = item.customer
                return typeof customer === 'object' && customer !== null && 'handle' in customer
                  ? String(customer.handle)
                  : ''
              },
            },
          }),
        },
        access: { operation: { query: () => true } },
      },
    },
  }

  test(
    'keeps the visible foreign key on a bare read and nulls it when the related list is denied',
    async () => {
      const db = await createTestDatabase(needsConfig)
      try {
        const sudo = db.context(null).sudo()
        const person = await sudo.db.Person.create({ data: { handle: 'u' } })
        if (!person) throw new Error('seed person')
        await sudo.db.Order.create({
          data: { ref: 'o-1', customer: { connect: { id: person.id } } },
        })
        const order = await db.context({ handle: 'reader' }).db.Order.first()
        expect(order?.customerId).toBe(person.id)
        expect(order?.customerName).toBe('u')

        const denied = await db.context(null).db.Order.first()
        expect(denied?.customerId).toBeNull()

        const projected = await db.context(null).db.Order.select('customerName').first()
        expect(projected).not.toHaveProperty('customerId')
      } finally {
        await db.close()
      }
    },
    BOOT,
  )
})

describe('a predicate, sort or column list on a to-one foreign key answers as the bare read does (#1621)', () => {
  test(
    'where on the hidden id matches nothing, and the visible id still matches',
    async () => {
      const asMine = database.context({ handle: 'mine' })
      expect(await asMine.db.Item.where({ ownerId: { equals: othersId } }).all()).toEqual([])
      const visible = await asMine.db.Item.where({ ownerId: { equals: mineId } }).all()
      expect(visible.map((item) => item.title)).toEqual(['mine-item'])
    },
    BOOT,
  )

  test(
    'count on the hidden id is zero',
    async () => {
      const asMine = database.context({ handle: 'mine' })
      const { n } = await asMine.db.Item.where({ ownerId: { equals: othersId } }).aggregate(
        (aggregate) => ({ n: aggregate.count() }),
      )
      expect(n).toBe(0)
    },
    BOOT,
  )

  test(
    'a session the related list denies entirely matches nothing',
    async () => {
      const anonymous = database.context(null)
      expect(await anonymous.db.Item.where({ ownerId: { equals: mineId } }).all()).toEqual([])
    },
    BOOT,
  )

  test(
    'equals null matches a row whose related row is hidden, as the bare read shows it',
    async () => {
      const asMine = database.context({ handle: 'mine' })
      const rows = await asMine.db.Item.where({ ownerId: { equals: null } }).all()
      expect(rows.map((item) => item.title)).toEqual(['others-item'])
    },
    BOOT,
  )

  test(
    'a list access filter naming the foreign key is not scoped by the related list',
    async () => {
      let target = ''
      const scratch = await createTestDatabase({
        ...config,
        lists: {
          ...config.lists,
          Item: {
            ...config.lists.Item,
            access: { operation: { query: () => ({ ownerId: { equals: target } }) } },
          },
        },
      })
      try {
        const sudo = scratch.context(null).sudo()
        const org = await sudo.db.Org.create({ data: { handle: 'others' } })
        if (!org) throw new Error('seed org')
        target = String(org.id)
        await sudo.db.Item.create({ data: { title: 'x', owner: { connect: { id: target } } } })
        const rows = await scratch.context({ handle: 'mine' }).db.Item.all()
        expect(rows.map((item) => item.title)).toEqual(['x'])
      } finally {
        await scratch.close()
      }
    },
    BOOT,
  )

  test(
    'orderBy and distinct on the foreign key are refused while the related list scopes reads',
    async () => {
      const asMine = database.context({ handle: 'mine' })
      await expect(asMine.db.Item.orderBy({ ownerId: 'asc' }).all()).rejects.toThrow()
      await expect(asMine.db.Item.distinct('ownerId').all()).rejects.toThrow()
    },
    BOOT,
  )
})

describe('sudo is not narrowed by the session foreign-key rules', () => {
  test(
    'a bare sudo read returns every foreign key, agreeing with a sudo include',
    async () => {
      for (const session of [null, { handle: 'mine' }]) {
        const sudo = database.context(session).sudo()
        const bare = await sudo.db.Item.all()
        const included = await sudo.db.Item.include('owner').all()
        const ids = (rows: typeof bare) =>
          rows
            .map((row) => [row.title, row.ownerId])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        expect(ids(bare)).toEqual([
          ['mine-item', mineId],
          ['others-item', othersId],
        ])
        expect(ids(included)).toEqual(ids(bare))
      }
    },
    BOOT,
  )
})

describe('a write result narrows foreign keys exactly as a bare read does', () => {
  test(
    'update() returns the same owner and secret foreign keys first() does',
    async () => {
      const asMine = database.context({ handle: 'mine' })
      const read = await asMine.db.Item.where({ id: { equals: itemOthersId } }).first()
      const written = await asMine.db.Item.update({
        where: { id: itemOthersId },
        data: { title: 'others-item' },
      })
      expect(read?.ownerId).toBeNull()
      expect(written?.ownerId).toBe(read?.ownerId)
      expect(written?.secretId).toBeNull()
      expect(written?.secretId).toBe(read?.secretId)
    },
    BOOT,
  )

  test(
    'update() keeps a foreign key the session can see',
    async () => {
      const asMine = database.context({ handle: 'mine' })
      const written = await asMine.db.Item.update({
        where: { id: itemMineId },
        data: { title: 'mine-item' },
      })
      expect(written?.ownerId).toBe(mineId)
    },
    BOOT,
  )

  test(
    'create() nulls a foreign key the session cannot read back',
    async () => {
      const asMine = database.context({ handle: 'mine' })
      const created = await asMine.db.Item.create({
        data: {
          title: 'fresh',
          owner: { connect: { id: mineId } },
          secret: { connect: { id: mineId } },
          renamed: { connect: { id: mineId } },
        },
      })
      expect(created?.ownerId).toBe(mineId)
      expect(created?.secretId).toBeNull()
    },
    BOOT,
  )
})
