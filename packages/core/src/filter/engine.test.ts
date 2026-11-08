import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { AccessContext, Session } from '../access/types.js'
import { calendarDay, integer, relationship, select, text, timestamp } from '../fields/index.js'
import { withOrigin } from '../origin.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { buildListFilterWhere } from './collect.js'

const BOOT = 120_000

let ada: Session = {}
const auditor: Session = { role: 'auditor' }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    User: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
      access: { operation: { query: () => true } },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        slug: text(),
        author: relationship({ ref: 'User.posts' }),
        ledger: relationship({ ref: 'Ledger.posts' }),
        category: select({
          options: [
            { label: 'Product', value: 'product' },
            { label: 'News', value: 'news' },
          ],
        }),
        secret: text({ access: { read: () => false } }),
      },
      access: { operation: { query: () => true } },
    },
    Ledger: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.ledger', many: true }),
      },
      access: { operation: { query: ({ session }) => String(session?.role ?? '') === 'auditor' } },
    },
    // No free-text field at all (#1356) — an undegradable token here has
    // nowhere to search, and must narrow the read to nothing rather than
    // silently dropping the token and returning every row.
    Setting: {
      fields: { priority: integer(), due: calendarDay(), at: timestamp() },
      access: { operation: { query: () => true } },
    },
  },
}

let database: TestDatabase

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function seed(model: string, row: object): Promise<Record<string, unknown>> {
  const namespace: unknown = Reflect.get(database.client.orm, 'public')
  if (!isRecord(namespace)) throw new Error('no public namespace')
  const target: unknown = Reflect.get(namespace, model)
  if (!isRecord(target)) throw new Error(`no collection "${model}"`)
  const create: unknown = target.create
  if (typeof create !== 'function') throw new Error(`collection "${model}" has no create`)
  return withOrigin('unsafe', async () => {
    const created: unknown = await create.call(target, row)
    if (!isRecord(created)) throw new Error('create returned no row')
    return created
  })
}

async function filtered(
  listKey: string,
  query: string,
  session: Session = ada,
): Promise<Record<string, unknown>[]> {
  const context = database.context(session)
  // `getContext` returns the narrower `StackContext` view of the same object
  // the access seam takes as an `AccessContext` — the bridge every other core
  // test over the Test context makes (`access/multi-column-read-write.test.ts`).
  const accessContext = context as unknown as AccessContext
  const where = await buildListFilterWhere(query, config.lists[listKey], listKey, config, {
    session: context.session,
    context: accessContext,
  })
  const read = context.db[listKey]
  return await (where ? read.where(where) : read).all()
}

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  await database.truncate()
  const author = await seed('User', { name: 'Ada' })
  ada = { userId: author.id }
  await seed('User', { name: 'Grace' })
  await seed('Post', {
    title: 'On Engines',
    authorId: author.id,
    category: 'product',
    secret: 'x',
  })
  await seed('Post', { title: 'On Looms', authorId: author.id, category: 'news', secret: 'y' })
  const ledger = await seed('Ledger', { name: 'private' })
  await seed('Post', { title: 'On Ledgers', ledgerId: ledger.id })
  await seed('Setting', {
    priority: 1,
    due: '2026-11-01',
    at: '2026-11-01T13:00:00.000Z',
  })
  await seed('Setting', {
    priority: 2,
    due: '2026-11-02',
    at: '2026-11-01T12:59:59.999Z',
  })
})

describe('the filter engine over the secured surface', () => {
  test(
    'a text token matches case-insensitively: `name:ada` finds `Ada`',
    async () => {
      const rows = await filtered('User', 'name:ada')
      expect(rows.map((row) => row.name)).toEqual(['Ada'])
    },
    BOOT,
  )

  test(
    'a bare free-text word matches case-insensitively too',
    async () => {
      const rows = await filtered('User', 'GRACE')
      expect(rows.map((row) => row.name)).toEqual(['Grace'])
    },
    BOOT,
  )

  test(
    'a quoted field-shaped word is free text, and an escaped quote reaches the value',
    async () => {
      await seed('User', { name: 'name:Ada' })
      await seed('User', { name: 'Ada "the Countess"' })
      expect((await filtered('User', '"name:Ada"')).map((row) => row.name)).toEqual(['name:Ada'])
      expect((await filtered('User', 'name:"\\"the Countess\\""')).map((row) => row.name)).toEqual([
        'Ada "the Countess"',
      ])
    },
    BOOT,
  )

  test(
    'a to-one label token matches through the relation',
    async () => {
      const rows = await filtered('Post', 'author:ada')
      expect(rows.map((row) => row.title).sort()).toEqual(['On Engines', 'On Looms'])
      expect(await filtered('Post', 'author:grace')).toEqual([])
    },
    BOOT,
  )

  test(
    'a relationship filter over a list the session cannot query returns no rows and no error',
    async () => {
      // The row the token matches exists and is reachable: an auditor's read of
      // the same filter finds it. Everything that makes it invisible to `ada` is
      // the engine folding Ledger's `query` rule into the relation filter.
      expect((await filtered('Post', 'ledger:private', auditor)).map((row) => row.title)).toEqual([
        'On Ledgers',
      ])
      await expect(filtered('Post', 'ledger:private')).resolves.toEqual([])
    },
    BOOT,
  )

  test(
    'a to-many count token lowers to presence',
    async () => {
      expect((await filtered('User', 'posts:>0')).map((row) => row.name)).toEqual(['Ada'])
      expect((await filtered('User', 'posts:0')).map((row) => row.name)).toEqual(['Grace'])
    },
    BOOT,
  )

  test(
    'any other count comparison degrades to free text rather than breaking the page',
    async () => {
      // `posts:>5` cannot lower — the degraded token is searched as free text
      // over `name`, which matches nothing rather than throwing.
      await expect(filtered('User', 'posts:>5')).resolves.toEqual([])
    },
    BOOT,
  )

  test(
    'an undegradable token on a list with no free-text field narrows to no rows, not every row',
    async () => {
      // `Setting` has no free-text field: `priority` isn't one, and `label`
      // doesn't exist. Both rows seeded above would come back if the token
      // were silently dropped instead of narrowing the read (#1356).
      await expect(filtered('Setting', 'label:urgent')).resolves.toEqual([])
      // Renders without error rather than throwing — the #1127 story 13
      // "never break the page on a bookmarked filter" guarantee still holds.
      await expect(filtered('Setting', 'priority:>lots')).resolves.toEqual([])
    },
    BOOT,
  )

  test(
    'a range is inclusive at both ends, and an invalid one narrows rather than widens',
    async () => {
      const priorities = async (query: string) =>
        (await filtered('Setting', query)).map((row) => row.priority).sort()
      expect(await priorities('priority:1..2')).toEqual([1, 2])
      expect(await priorities('priority:2..9')).toEqual([2])
      expect(await priorities('priority:>=2 priority:<=9')).toEqual([2])
      expect(await priorities('due:2026-11-02..2026-11-30')).toEqual([2])
      expect(await priorities('due:2026-11-01..2026-11-01')).toEqual([1])
      await expect(filtered('Setting', 'priority:one..2')).resolves.toEqual([])
      await expect(filtered('Setting', 'due:2026-02-31..2026-03-01')).resolves.toEqual([])
    },
    BOOT,
  )

  test(
    '`field:a..b` on a field with no range keeps its field scope, as that field’s eq on `a..b`',
    async () => {
      await seed('Post', { title: 'wait...what', slug: 'post-a' })
      await seed('Post', { title: 'post-b', slug: 'wait...what' })
      await seed('Post', { title: 'v1..v2 notes', slug: 'post-c' })
      await seed('Post', { title: 'post-d', slug: 'v1..v2' })
      const titles = async (query: string) =>
        (await filtered('Post', query)).map((row) => row.title).sort()
      expect(await titles('title:wait...what')).toEqual(['wait...what'])
      expect(await titles('title:wait...what')).toEqual(await titles('title:"wait...what"'))
      expect(await titles('slug:v1..v2')).toEqual(['post-d'])
      expect(await titles('slug:v1..v2')).toEqual(await titles('slug:"v1..v2"'))
      expect(await titles('v1..v2')).toEqual(['post-d', 'v1..v2 notes'])
    },
    BOOT,
  )

  test(
    'a timestamp range follows the offset its instants carry, end of day inclusive',
    async () => {
      const priorities = async (query: string) =>
        (await filtered('Setting', query)).map((row) => row.priority).sort()
      const sydneyDay = 'at:2026-11-02T00:00:00.000+11:00..2026-11-02T23:59:59.999+11:00'
      const utcDay = 'at:2026-11-01T00:00:00.000+00:00..2026-11-01T23:59:59.999+00:00'
      expect(await priorities(sydneyDay)).toEqual([1])
      expect(await priorities(utcDay)).toEqual([1, 2])
    },
    BOOT,
  )
})

const titles = (rows: Record<string, unknown>[]) => rows.map((row) => String(row.title)).sort()

describe('is not, any of and is empty over the secured surface (ADR-0083)', () => {
  test(
    '"is not" keeps the rows with no value',
    async () => {
      expect(titles(await filtered('Post', '-category:product'))).toEqual([
        'On Ledgers',
        'On Looms',
      ])
    },
    BOOT,
  )

  test(
    '"does not contain" on a relationship keeps the rows with no related record',
    async () => {
      expect(titles(await filtered('Post', '-author:ada'))).toEqual(['On Ledgers'])
    },
    BOOT,
  )

  test(
    '"is any of" matches a row holding any of the values',
    async () => {
      expect(titles(await filtered('Post', 'category:product,news'))).toEqual([
        'On Engines',
        'On Looms',
      ])
      expect(titles(await filtered('Post', '-category:product,news'))).toEqual(['On Ledgers'])
    },
    BOOT,
  )

  test(
    '"is empty" and "is not empty" split the rows on whether the field has a value',
    async () => {
      expect(titles(await filtered('Post', 'category:!'))).toEqual(['On Ledgers'])
      expect(titles(await filtered('Post', '-category:!'))).toEqual(['On Engines', 'On Looms'])
      expect(titles(await filtered('Post', 'author:!'))).toEqual(['On Ledgers'])
    },
    BOOT,
  )

  test(
    '`-secret:x` on a field the session cannot read stays the literal word, never a negation',
    async () => {
      await seed('Post', { title: 'Reading -secret:x', secret: 'x' })
      expect(titles(await filtered('Post', '-secret:x'))).toEqual(['Reading -secret:x'])
      expect(titles(await filtered('Post', 'secret:!'))).toEqual([])
    },
    BOOT,
  )

  test(
    'a list with a value its field rejects is searched as one word, never as the values that map',
    async () => {
      await seed('Post', { title: 'About product,bogus' })
      expect(titles(await filtered('Post', 'category:product,bogus'))).toEqual([
        'About product,bogus',
      ])
    },
    BOOT,
  )

  test(
    'a positive token on an unknown field searches its value',
    async () => {
      await seed('Post', { title: 'Findable Title' })
      expect(titles(await filtered('Post', 'nosuchfield:Findable'))).toEqual(['Findable Title'])
    },
    BOOT,
  )

  test(
    'a list on a field the session cannot read is searched as one word, its values',
    async () => {
      await seed('Post', { title: 'Reading a,b', secret: 'a' })
      await seed('Post', { title: 'Reading a', secret: 'b' })
      expect(titles(await filtered('Post', 'secret:a,b'))).toEqual(['Reading a,b'])
    },
    BOOT,
  )

  test(
    'a quoted negated token that cannot map is searched with its quotes',
    async () => {
      await seed('Post', { title: 'Reading -secret:"Ada Lovelace"' })
      await seed('Post', { title: 'Reading -secret:Ada Lovelace' })
      expect(titles(await filtered('Post', '-secret:"Ada Lovelace"'))).toEqual([
        'Reading -secret:"Ada Lovelace"',
      ])
    },
    BOOT,
  )

  test(
    'a negated filter only narrows: a list the session cannot query still returns nothing',
    async () => {
      expect((await filtered('Ledger', '-name:nothing', auditor)).map((row) => row.name)).toEqual([
        'private',
      ])
      await expect(filtered('Ledger', '-name:nothing')).resolves.toEqual([])
      await expect(filtered('Ledger', 'name:!')).resolves.toEqual([])
    },
    BOOT,
  )
})

describe('a negated range over the secured surface (ADR-0083)', () => {
  const priorities = async (query: string) =>
    (await filtered('Setting', query)).map((row) => String(row.priority)).sort()

  test(
    '`-field:a..b` excludes the range and keeps the rows with no value',
    async () => {
      await seed('Setting', { due: '2026-12-01' })
      expect(await priorities('-priority:2..9')).toEqual(['1', 'null'])
      expect(await priorities('-due:2026-11-02..2026-11-30')).toEqual(['1', 'null'])
    },
    BOOT,
  )

  test(
    'a negated range that cannot map is searched as its literal, never negated',
    async () => {
      await expect(filtered('Setting', '-priority:one..2')).resolves.toEqual([])
      await seed('Post', { title: 'Reading -secret:a..b', secret: 'q' })
      expect(titles(await filtered('Post', '-secret:a..b'))).toEqual(['Reading -secret:a..b'])
    },
    BOOT,
  )

  test(
    '`-field:a..b` on a field with no range is that field’s negated eq on `a..b`',
    async () => {
      await seed('Post', { title: 'post-x', slug: 'v1..v2' })
      await seed('Post', { title: 'post-y', slug: 'other' })
      const excluded = titles(await filtered('Post', '-slug:v1..v2'))
      expect(excluded).toEqual(titles(await filtered('Post', '-slug:"v1..v2"')))
      expect(excluded).not.toContain('post-x')
      expect(excluded).toContain('post-y')
    },
    BOOT,
  )
})
