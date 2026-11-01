import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import { config as defineConfig } from '@opensaas/stack-core'
import { authPlugin } from '../src/config/plugin.js'
import { getAuthListRegistry } from '../src/lists/index.js'
import { opensaasAuthAdapter } from '../src/adapter/index.js'
import { fitIdToStrategy } from '../src/adapter/forced-id.js'
import type { NormalizedAuthConfig } from '../src/config/types.js'

const RESERVATION_ID = 'dGhpcy1pcy1hLTQzLWNoYXJhY3Rlci1iYXNlNjR1cmwtaWQ'

describe('fitIdToStrategy', () => {
  it('passes a conforming uuid through and maps anything else deterministically', () => {
    const uuid = '0190b7a0-0000-7000-8000-000000000000'
    expect(fitIdToStrategy('uuid7', uuid)).toBe(uuid)
    const mapped = fitIdToStrategy('uuid7', RESERVATION_ID)
    expect(mapped).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(fitIdToStrategy('uuid7', RESERVATION_ID)).toBe(mapped)
  })

  it('maps a non-conforming id to a cuid2-shaped one for cuid2 lists', () => {
    expect(fitIdToStrategy('cuid2', RESERVATION_ID)).toMatch(/^[a-z][a-z0-9]{23}$/)
  })
})

describe('forced non-uuid ids on a uuid id column', () => {
  let database: TestDatabase
  let adapter: ReturnType<ReturnType<typeof opensaasAuthAdapter>>
  let factory: ReturnType<typeof opensaasAuthAdapter>

  beforeAll(async () => {
    const built = await defineConfig({
      plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
      db: { provider: 'postgresql' },
      lists: {},
    })
    database = await createTestDatabase(built)
    const normalized = built._pluginData?.auth as NormalizedAuthConfig
    const context = database.context()
    factory = opensaasAuthAdapter({
      config: built,
      unsafe: context.unsafe,
      registry: getAuthListRegistry(normalized.models, normalized.betterAuthPlugins),
      transaction: (body) => context.transaction((tx) => body(tx.unsafe)),
    })
    adapter = factory({})
  })

  afterAll(async () => {
    await database.close()
  })

  const reservation = () => ({
    id: RESERVATION_ID,
    identifier: 'reserve-me',
    value: 'v',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  it('creates, finds by the forced id, and conflicts on a second create', async () => {
    await adapter.create({ model: 'verification', data: reservation(), forceAllowId: true })

    const found = await adapter.findOne({
      model: 'verification',
      where: [{ field: 'id', value: RESERVATION_ID }],
    })
    expect(found).not.toBeNull()

    await expect(
      adapter.create({ model: 'verification', data: reservation(), forceAllowId: true }),
    ).rejects.toThrow()

    const many = await adapter.findMany({
      model: 'verification',
      where: [{ field: 'id', operator: 'in', value: [RESERVATION_ID] }],
    })
    expect(many).toHaveLength(1)
  })

  it('updates, consumes and deletes by the original forced id', async () => {
    const id = `${RESERVATION_ID}-b`
    await adapter.create({
      model: 'verification',
      data: { ...reservation(), id, identifier: 'other' },
      forceAllowId: true,
    })
    const where = [{ field: 'id', value: id }]
    const updated = await adapter.update({ model: 'verification', where, update: { value: 'w' } })
    expect(updated).toMatchObject({ value: 'w' })
    const consumed = await adapter.consumeOne({ model: 'verification', where })
    expect(consumed).not.toBeNull()
    expect(await adapter.findOne({ model: 'verification', where })).toBeNull()
  })

  it('keeps a database-minted uuid7 id for creates with no forced id under generateId: uuid', async () => {
    const uuidAdapter = factory({ advanced: { database: { generateId: 'uuid' } } })
    const { id: _forced, ...data } = reservation()
    const created = await uuidAdapter.create({
      model: 'verification',
      data: { ...data, identifier: 'plain' },
    })
    expect(created).toMatchObject({ id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/) })

    const forcedId = '3f6b1c52-a3d4-5e0f-9b7e-2c58d4a1e390'
    const input = { ...reservation(), id: forcedId, identifier: 'forced-uuid-mode' }
    await uuidAdapter.create({ model: 'verification', data: input, forceAllowId: true })
    await expect(
      uuidAdapter.create({ model: 'verification', data: input, forceAllowId: true }),
    ).rejects.toThrow()
  })
})
