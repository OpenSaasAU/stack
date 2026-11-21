import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { SqlExecutionPlan } from '@prisma/orm-postgres/relational-core'
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime'
import type { OpenSaasConfig } from '../config/types.js'
import { TransactionRolledBackError } from '../context/index.js'
import { text } from '../fields/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'

const BOOT = 120_000

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: { Note: { fields: { body: text() }, access: { operation: OPEN } } },
}

class InjectedStatementFailure extends Error {
  constructor() {
    super('injected statement failure')
    this.name = 'InjectedStatementFailure'
  }
}

const injected: InjectedStatementFailure[] = []
let armed = false

const failAdvisoryLock: SqlMiddleware = {
  name: 'opensaas-advisory-lock-failure',
  familyId: 'sql',
  beforeEncode: (plan: SqlExecutionPlan) => {
    if (!armed || !plan.sql.includes('pg_advisory_xact_lock')) return
    armed = false
    const failure = new InjectedStatementFailure()
    injected.push(failure)
    throw failure
  },
}

describe('advisoryLock()', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(config, { userId: 'u1' }, { middleware: [failAdvisoryLock] })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    armed = false
    injected.length = 0
    await harness.truncate()
  })

  test(
    'poisons the transaction owner when it fails, so a caught failure still rolls back',
    async () => {
      const caught: unknown[] = []
      const rejection = await harness.context
        .transaction(async (tx) => {
          await tx.db.Note.create({ data: { body: 'inside' } })
          armed = true
          await tx.advisoryLock('k').catch((error: unknown) => caught.push(error))
        })
        .catch((error: unknown) => error)

      expect(injected).toHaveLength(1)
      expect(caught).toEqual([injected[0]])
      expect(rejection).toBeInstanceOf(TransactionRolledBackError)
      if (rejection instanceof TransactionRolledBackError) expect(rejection.cause).toBe(caught[0])
      expect(await harness.context.sudo().db.Note.all()).toEqual([])
    },
    BOOT,
  )
})
