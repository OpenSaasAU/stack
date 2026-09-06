// Every statement the Auth adapter issues carries the unsafe origin.
//
// The tripwire is installed unconditionally by the Test context and has no
// warn mode, so an unmarked statement is a thrown `UnmarkedQueryError` rather
// than a soft assertion (ADR-0059). Each method below therefore proves its own
// coverage by completing at all; the recorder is what proves it for *every*
// statement a multi-statement terminal issues — a single-row ORM `update()` or
// `delete()` is two.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { config as defineConfig } from '@opensaas/stack-core'
import { createPlanRecorder, createTestDatabase } from '@opensaas/stack-core/testing'
import type { PlanRecorder, TestDatabase } from '@opensaas/stack-core/testing'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import type { DBAdapter } from 'better-auth/adapters'
import type { BetterAuthOptions } from 'better-auth'
import { authPlugin } from '../src/config/plugin.js'
import { getAuthListRegistry } from '../src/lists/index.js'
import { opensaasAuthAdapter } from '../src/adapter/index.js'
import type { NormalizedAuthConfig } from '../src/config/types.js'

const BOOT = 120_000

const betterAuthOptions: BetterAuthOptions = {
  rateLimit: { storage: 'database' },
}

let database: TestDatabase
let opensaasConfig: OpenSaasConfig
let recorder: PlanRecorder
let adapter: DBAdapter<BetterAuthOptions>

beforeAll(async () => {
  recorder = createPlanRecorder()
  opensaasConfig = await defineConfig({
    plugins: [
      authPlugin({ emailAndPassword: { enabled: true }, rateLimit: { storage: 'database' } }),
    ],
    db: { provider: 'postgresql' },
    lists: {},
  })
  database = await createTestDatabase(opensaasConfig, { middleware: [recorder.middleware] })
  const normalized = opensaasConfig._pluginData?.auth as NormalizedAuthConfig
  adapter = opensaasAuthAdapter({
    config: opensaasConfig,
    unsafe: database.context().unsafe,
    registry: getAuthListRegistry(normalized.models, normalized.betterAuthPlugins),
  })(betterAuthOptions)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  await database.truncate()
  recorder.clear()
})

async function seedUser(email = `${randomUUID()}@example.com`): Promise<{ id: string }> {
  const created = await adapter.create<{ email: string; name: string }, { id: string }>({
    model: 'user',
    data: { email, name: 'Ada' },
  })
  recorder.clear()
  return created
}

function origins(): (string | undefined)[] {
  return recorder.plans.map((plan) => plan.origin)
}

describe('every adapter method runs under the unsafe origin', () => {
  test('create', async () => {
    await seedUser()
    // seedUser clears the recorder, so replay the statement it just proved.
    await adapter.create({ model: 'user', data: { email: `${randomUUID()}@x.io`, name: 'Ada' } })
    expect(recorder.plans.length).toBeGreaterThan(0)
    expect(origins()).toEqual(recorder.plans.map(() => 'unsafe'))
  })

  test('findOne and findMany', async () => {
    const user = await seedUser()
    await adapter.findOne({ model: 'user', where: [{ field: 'id', value: user.id }] })
    await adapter.findMany({ model: 'user', where: [], limit: 10 })
    expect(recorder.plans).toHaveLength(2)
    expect(origins()).toEqual(['unsafe', 'unsafe'])
  })

  test('count', async () => {
    await seedUser()
    expect(await adapter.count({ model: 'user' })).toBe(1)
    expect(origins()).toEqual(['unsafe'])
  })

  test('update covers every statement', async () => {
    const user = await seedUser()
    const updated = await adapter.update<{ name: string }>({
      model: 'user',
      where: [{ field: 'id', value: user.id }],
      update: { name: 'Grace' },
    })
    expect(updated?.name).toBe('Grace')
    // A single-row ORM update resolves the identity, then writes it.
    expect(recorder.plans.length).toBeGreaterThan(1)
    expect(origins()).toEqual(recorder.plans.map(() => 'unsafe'))
  })

  test('updateMany', async () => {
    await seedUser()
    await adapter.updateMany({
      model: 'user',
      where: [{ field: 'name', value: 'Ada' }],
      update: { name: 'Grace' },
    })
    expect(recorder.plans.length).toBeGreaterThan(0)
    expect(origins()).toEqual(recorder.plans.map(() => 'unsafe'))
  })

  test('delete covers every statement', async () => {
    const user = await seedUser()
    await adapter.delete({ model: 'user', where: [{ field: 'id', value: user.id }] })
    // Two statements, not one `DELETE … RETURNING`: Prisma resolves the
    // identity first (a stated known limit of the ORM lane).
    expect(recorder.plans.length).toBeGreaterThan(1)
    expect(origins()).toEqual(recorder.plans.map(() => 'unsafe'))
  })

  test('deleteMany with a where', async () => {
    await seedUser()
    expect(
      await adapter.deleteMany({ model: 'user', where: [{ field: 'name', value: 'Ada' }] }),
    ).toBe(1)
    expect(origins()).toEqual(recorder.plans.map(() => 'unsafe'))
  })

  test('deleteMany with an empty where runs the typed-SQL statement', async () => {
    await seedUser()
    expect(await adapter.deleteMany({ model: 'user', where: [] })).toBe(1)
    expect(recorder.plans).toHaveLength(1)
    expect(recorder.plans[0].kind).toBe('delete')
    expect(origins()).toEqual(['unsafe'])
  })

  test('consumeOne covers every statement', async () => {
    await adapter.create({
      model: 'verification',
      data: {
        identifier: 'once',
        value: 'token',
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    recorder.clear()

    const consumed = await adapter.consumeOne<{ identifier: string }>({
      model: 'verification',
      where: [{ field: 'identifier', value: 'once' }],
    })
    expect(consumed?.identifier).toBe('once')
    expect(recorder.plans.length).toBeGreaterThan(1)
    expect(origins()).toEqual(recorder.plans.map(() => 'unsafe'))

    recorder.clear()
    const second = await adapter.consumeOne({
      model: 'verification',
      where: [{ field: 'identifier', value: 'once' }],
    })
    expect(second).toBeNull()
    expect(origins()).toEqual(recorder.plans.map(() => 'unsafe'))
  })

  test('incrementOne runs one typed-SQL statement under the origin', async () => {
    await adapter.create({
      model: 'rateLimit',
      data: { key: 'ip:1', count: 1, lastRequest: 10 },
    })
    recorder.clear()

    const bumped = await adapter.incrementOne<{ count: number }>({
      model: 'rateLimit',
      where: [{ field: 'key', value: 'ip:1' }],
      increment: { count: 2 },
      set: { lastRequest: 20 },
    })
    expect(bumped?.count).toBe(3)
    expect(recorder.plans).toHaveLength(1)
    expect(recorder.plans[0].kind).toBe('update')
    expect(origins()).toEqual(['unsafe'])
  })

  test('incrementOne answers null when the guard matches no row', async () => {
    await adapter.create({ model: 'rateLimit', data: { key: 'ip:2', count: 0, lastRequest: 10 } })
    const guarded = await adapter.incrementOne({
      model: 'rateLimit',
      where: [
        { field: 'key', value: 'ip:2' },
        { field: 'count', operator: 'gt', value: 0 },
      ],
      increment: { count: -1 },
    })
    expect(guarded).toBeNull()
  })
})
