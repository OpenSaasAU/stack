import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
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
      access: { operation: { query: () => true } },
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
