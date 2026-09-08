import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
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
        fields: { siteName: text() },
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
    'get() resolves the row through the secured read, scoped by the query rule',
    async () => {
      await harness.context.db.Settings.create({ data: { siteName: 'visible' } })

      expect(await harness.context.db.Settings.get?.()).toMatchObject({
        id: 1,
        siteName: 'visible',
      })

      const denied = getContext(
        {
          ...schemaConfig(),
          lists: {
            ...schemaConfig().lists,
            Settings: {
              isSingleton: true,
              fields: { siteName: text() },
              access: { operation: { query: () => false, create: () => true } },
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

      expect(await denied.db.Settings.get?.()).toBeNull()
    },
    BOOT,
  )

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
