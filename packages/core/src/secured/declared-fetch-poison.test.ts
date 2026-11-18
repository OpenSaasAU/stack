import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { SqlExecutionPlan } from '@prisma/orm-postgres/relational-core'
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime'
import type { OpenSaasConfig } from '../config/types.js'
import { TransactionRolledBackError } from '../context/index.js'
import { relationship, text, virtual } from '../fields/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'

const BOOT = 120_000

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Writer: {
      fields: {
        name: text(),
        articles: relationship({ ref: 'Article.writer', many: true }),
        articleCount: virtual({
          type: 'number',
          needs: ['articles'],
          hooks: {
            resolveOutput: ({ item }) => (Array.isArray(item.articles) ? item.articles.length : -1),
          },
        }),
      },
      access: { operation: OPEN },
    },
    Article: {
      fields: { title: text(), writer: relationship({ ref: 'Writer.articles' }) },
      access: { operation: OPEN },
    },
  },
}

class InjectedStatementFailure extends Error {
  constructor() {
    super('injected failure of the declared-rows fetch')
    this.name = 'InjectedStatementFailure'
  }
}

let issued = 0
let failAt: number | undefined

const failNthStatement: SqlMiddleware = {
  name: 'opensaas-declared-fetch-failure',
  familyId: 'sql',
  beforeEncode: (_plan: SqlExecutionPlan) => {
    issued += 1
    if (issued === failAt) throw new InjectedStatementFailure()
  },
}

describe('the declared-rows fetch of a caller-shaped include', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(config, { userId: 'u1' }, { middleware: [failNthStatement] })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    failAt = undefined
    await harness.truncate()
    const admin = harness.context.sudo()
    const writer = await admin.db.Writer.create({ data: { name: 'w' } })
    for (const title of ['a', 'b']) {
      await admin.db.Article.create({ data: { title, writer: { connect: { id: writer!.id } } } })
    }
    issued = 0
  })

  test(
    'is the second statement of the read, after the one an unshaped include issues alone',
    async () => {
      await harness.context.db.Writer.include('articles').all()
      expect(issued).toBe(1)
      issued = 0
      const [writer] = await harness.context.db.Writer.include('articles', (articles) =>
        articles.where({ title: { equals: 'a' } }),
      ).all()
      expect(issued).toBe(2)
      expect(writer).toMatchObject({ articleCount: 2, articles: [{ title: 'a' }] })
    },
    BOOT,
  )

  test(
    'poisons the transaction owner when it fails, so a caught failure still rolls back',
    async () => {
      const caught: unknown[] = []
      const rejection = await harness.context
        .transaction(async (tx) => {
          await tx.db.Writer.create({ data: { name: 'inside' } })
          failAt = issued + 2
          await tx.db.Writer.include('articles', (articles) =>
            articles.where({ title: { equals: 'a' } }),
          )
            .all()
            .catch((error: unknown) => caught.push(error))
          failAt = undefined
        })
        .catch((error: unknown) => error)

      expect(caught).toHaveLength(1)
      expect(caught[0]).toBeInstanceOf(InjectedStatementFailure)
      expect(rejection).toBeInstanceOf(TransactionRolledBackError)
      if (rejection instanceof TransactionRolledBackError) expect(rejection.cause).toBe(caught[0])
      const names = (await harness.context.sudo().db.Writer.all()).map((row) => row.name)
      expect(names).toEqual(['w'])
    },
    BOOT,
  )
})
