import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { createTestContext, type TestContext } from '../testing/context.js'
import { calendarDay } from './index.js'

/**
 * calendarDay's `resolveInput` used to coerce a `YYYY-MM-DD` string into a
 * UTC-midnight `Date` before the write reached the ORM, for a Prisma 7
 * `@db.Date` validator that no longer exists (#621). The column now binds a
 * string codec that passes its value straight to the driver, so a `Date`
 * reaching it would be serialised by `pg` in the process's LOCAL timezone —
 * drifting a day under a negative offset. Every other calendarDay test
 * exercises the field builder's hooks directly, or a mocked ORM: neither
 * crosses the real field/column boundary. This one round-trips through a
 * real Postgres, under UTC and a negative offset, so a reintroduced
 * coercion fails here instead of surfacing as a silently wrong stored date.
 */

const BOOT = 120_000

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Event: {
        fields: { startsOn: calendarDay({ validation: { isRequired: true } }) },
        access: { operation: { query: () => true, create: () => true, update: () => true } },
      },
    },
  }
}

describe('calendarDay across the field/column boundary (#1437)', () => {
  let harness: TestContext
  const originalTz = process.env.TZ

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), null)
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
  })

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  // Los Angeles is a negative offset year-round — exactly the configuration
  // in which a UTC-midnight Date, reformatted by the driver in local time,
  // renders as the day before.
  for (const tz of ['UTC', 'America/Los_Angeles']) {
    test(`create+read round-trips '2025-01-15' with no drift under TZ=${tz}`, async () => {
      process.env.TZ = tz

      const created = await harness.context.db.Event.create({
        data: { startsOn: '2025-01-15' },
      })
      expect(created?.startsOn).toBe('2025-01-15')

      const read = await harness.context.db.Event.where({
        id: { equals: String(created!.id) },
      }).first()
      expect(read?.startsOn).toBe('2025-01-15')
    })
  }

  test('filters on the exact stored day', async () => {
    const created = await harness.context.db.Event.create({ data: { startsOn: '2025-06-01' } })
    expect(created).not.toBeNull()

    const match = await harness.context.db.Event.where({
      startsOn: { equals: '2025-06-01' },
    }).first()
    expect(match?.id).toBe(created!.id)

    const miss = await harness.context.db.Event.where({
      startsOn: { equals: '2025-06-02' },
    }).first()
    expect(miss).toBeNull()
  })
})
