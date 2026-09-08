import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { AccessControl } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { withOrigin } from '../origin.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import { getContext } from './index.js'

/**
 * A singleton list — one row, id 1, matching Keystone 6 (ADR-0004).
 *
 * The guards are what this pins: a second create is refused even under sudo, a
 * delete is refused at all, and the many-row surfaces are not offered at all.
 *
 * `get()` is the singleton's only read, and it resolves through the composed
 * secured read the other branch of `populateDbDelegate` exposes (#1255).
 */

const BOOT = 120_000

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Settings: {
        isSingleton: true,
        fields: { siteName: text(), owner: relationship({ ref: 'Post' }) },
        access: {
          operation: {
            query: () => true,
            create: () => true,
            update: () => true,
            delete: () => true,
          },
        },
      },
      Post: {
        fields: { title: text() },
        access: { operation: { query: () => true, create: () => true } },
      },
    },
  }
}

describe('a singleton list', () => {
  let harness: TestContext

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }

  /** How many Settings rows the table holds, read past every access seam. */
  async function settingsRowCount(): Promise<number> {
    const namespace: unknown = Reflect.get(harness.client.orm, 'public')
    if (!isRecord(namespace)) throw new Error('no public namespace')
    const collection: unknown = Reflect.get(namespace, 'Settings')
    if (!isRecord(collection)) throw new Error('no Settings collection')
    const aggregate: unknown = collection.aggregate
    if (typeof aggregate !== 'function') throw new Error('Settings has no aggregate')

    const result: unknown = await withOrigin('unsafe', () =>
      aggregate.call(collection, (builder: { count: () => unknown }) => ({
        rows: builder.count(),
      })),
    )
    if (!isRecord(result) || typeof result.rows !== 'number') {
      throw new Error('aggregate answered no row count')
    }
    return result.rows
  }

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), null)
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
  })

  test(
    'the first create lands on id 1',
    async () => {
      const created = await harness.context.db.Settings.create({ data: { siteName: 'My Site' } })

      expect(created).toMatchObject({ id: 1, siteName: 'My Site' })
    },
    BOOT,
  )

  test(
    'a second create is refused, and refused under sudo too',
    async () => {
      await harness.context.db.Settings.create({ data: { siteName: 'first' } })

      await expect(
        harness.context.db.Settings.create({ data: { siteName: 'second' } }),
      ).rejects.toThrow(/singleton list with an existing record/)
      await expect(
        harness.context.sudo().db.Settings.create({ data: { siteName: 'second' } }),
      ).rejects.toThrow(/singleton list with an existing record/)
    },
    BOOT,
  )

  test(
    'the row can be updated',
    async () => {
      await harness.context.db.Settings.create({ data: { siteName: 'before' } })

      expect(
        await harness.context.db.Settings.update({ where: { id: 1 }, data: { siteName: 'after' } }),
      ).toMatchObject({ siteName: 'after' })
    },
    BOOT,
  )

  test(
    'delete is refused, and refused under sudo too',
    async () => {
      await harness.context.db.Settings.create({ data: { siteName: 'kept' } })

      await expect(harness.context.db.Settings.delete({ where: { id: 1 } })).rejects.toThrow(
        /singleton/,
      )
      await expect(harness.context.sudo().db.Settings.delete({ where: { id: 1 } })).rejects.toThrow(
        /singleton/,
      )
    },
    BOOT,
  )

  test(
    'get() resolves the row through the secured read',
    async () => {
      await harness.context.db.Settings.create({ data: { siteName: 'visible' } })

      expect(await harness.context.db.Settings.get?.()).toMatchObject({
        id: 1,
        siteName: 'visible',
      })
    },
    BOOT,
  )

  describe("get()'s auto-create against every form the query rule can take", () => {
    // The property under test is the write, not only the answer: a session that
    // may not read the singleton must never cause a row to exist, and a denied
    // read must be indistinguishable from an absent one. Each case therefore
    // counts the rows either side of the call rather than inferring from what
    // `get()` returned — the earlier test read a throw and never observed the
    // table (#1370 review, B2).

    const contextFor = (
      query: AccessControl | undefined,
      isSingleton: boolean | { autoCreate?: boolean } = true,
    ) =>
      getContext(
        {
          ...schemaConfig(),
          lists: {
            ...schemaConfig().lists,
            Settings: {
              isSingleton,
              fields: { siteName: text(), owner: relationship({ ref: 'Post' }) },
              access: { operation: { query, create: () => true } },
            },
          },
        },
        ormClientFor(harness.data, harness.client.orm),
        null,
        undefined,
        false,
        undefined,
        undefined,
        harness.client,
      )

    const matching: AccessControl = () => ({ siteName: { equals: 'visible' } })
    const excluding: AccessControl = () => ({ siteName: { equals: 'other' } })
    const throwing: AccessControl = () => {
      throw new Error('the rule itself failed')
    }

    const seeded = async () => {
      await harness.context.db.Settings.create({ data: { siteName: 'visible' } })
    }

    test.each([
      ['true', (): boolean => true, { siteName: 'visible' }],
      ['false', (): boolean => false, null],
      ['a filter that matches the row', matching, { siteName: 'visible' }],
      ['a filter that excludes the row', excluding, null],
      ['absent', undefined, null],
    ] as const)(
      'with a row present and a query rule of %s, get() answers without writing',
      async (_name, query, expected) => {
        await seeded()

        const answer = await contextFor(query).db.Settings.get?.()

        if (expected === null) expect(answer).toBeNull()
        else expect(answer).toMatchObject(expected)
        expect(await settingsRowCount()).toBe(1)
      },
      BOOT,
    )

    test.each([
      ['false', (): boolean => false],
      ['a filter', excluding],
      ['absent', undefined],
    ] as const)(
      'with no row and a query rule of %s, get() answers null and creates nothing',
      async (_name, query) => {
        expect(await settingsRowCount()).toBe(0)

        expect(await contextFor(query).db.Settings.get?.()).toBeNull()

        expect(await settingsRowCount()).toBe(0)
      },
      BOOT,
    )

    test(
      'with no row and a query rule of true, get() auto-creates the row and returns it',
      async () => {
        expect(await settingsRowCount()).toBe(0)

        expect(await contextFor(() => true).db.Settings.get?.()).toMatchObject({ id: 1 })

        expect(await settingsRowCount()).toBe(1)
      },
      BOOT,
    )

    test(
      'with autoCreate false and a query rule of true, get() answers null and creates nothing',
      async () => {
        expect(await settingsRowCount()).toBe(0)

        expect(await contextFor(() => true, { autoCreate: false }).db.Settings.get?.()).toBeNull()

        expect(await settingsRowCount()).toBe(0)
      },
      BOOT,
    )

    test(
      'a throwing query rule propagates and creates nothing, row present or absent',
      async () => {
        await expect(contextFor(throwing).db.Settings.get?.()).rejects.toThrow(
          'the rule itself failed',
        )
        expect(await settingsRowCount()).toBe(0)

        await seeded()
        await expect(contextFor(throwing).db.Settings.get?.()).rejects.toThrow(
          'the rule itself failed',
        )
        expect(await settingsRowCount()).toBe(1)
      },
      BOOT,
    )

    test(
      'the auto-created row is handed back through the secured read, so an include lands',
      async () => {
        const created = await contextFor(() => true).db.Settings.get?.({
          include: { owner: true },
        })

        expect(created).toMatchObject({ id: 1 })
        // The row `createFn` returns carries no relation at all; only a read
        // through the composed query puts the key there.
        expect(created).toHaveProperty('owner', null)
      },
      BOOT,
    )

    test(
      'a denied read is not told apart from an absent one by the error it raises',
      async () => {
        await seeded()

        expect(await contextFor(excluding).db.Settings.get?.()).toBeNull()
        expect(await contextFor((): boolean => false).db.Settings.get?.()).toBeNull()
      },
      BOOT,
    )
  })

  test(
    'the secured read surface is absent on it, and present on an ordinary list',
    async () => {
      const members = ['where', 'orderBy', 'include', 'select', 'limit', 'offset', 'all']

      const settings = harness.context.db.Settings
      for (const member of members) expect(member in settings).toBe(false)
      expect(typeof settings.get).toBe('function')

      const post = harness.context.db.Post
      for (const member of members) expect(member in post).toBe(true)
      expect('get' in post).toBe(false)
    },
    BOOT,
  )
})
