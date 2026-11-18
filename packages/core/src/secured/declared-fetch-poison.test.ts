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

const DECLARED_FETCH =
  /^SELECT "Writer"\."id" AS "id", \(SELECT .* FROM "public"\."Article" WHERE "Article"\."writerId" = "Writer"\."id"\) AS "articles__rows"\) AS "articles" FROM "public"\."Writer" WHERE "Writer"\."id" IN \(/
const SHAPED_MAIN_READ =
  /^SELECT "Writer"\."id" AS "id", "Writer"\."name" AS "name", \(SELECT .* WHERE \("Article"\."writerId" = "Writer"\."id" AND "Article"\."title" = \$1\)\) AS "articles__rows"\) AS "articles" FROM "public"\."Writer"$/

const isDeclaredFetch = (sql: string): boolean => DECLARED_FETCH.test(sql)
const isShapedMainRead = (sql: string): boolean => SHAPED_MAIN_READ.test(sql)

class InjectedStatementFailure extends Error {
  constructor(readonly sql: string) {
    super('injected statement failure')
    this.name = 'InjectedStatementFailure'
  }
}

const statements: string[] = []
const injected: InjectedStatementFailure[] = []
let failWhen: ((sql: string) => boolean) | undefined

const failMatchingStatement: SqlMiddleware = {
  name: 'opensaas-declared-fetch-failure',
  familyId: 'sql',
  beforeEncode: (plan: SqlExecutionPlan) => {
    statements.push(plan.sql)
    if (failWhen?.(plan.sql) !== true) return
    failWhen = undefined
    const failure = new InjectedStatementFailure(plan.sql)
    injected.push(failure)
    throw failure
  },
}

describe('the declared-rows fetch of a caller-shaped include', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(
      config,
      { userId: 'u1' },
      { middleware: [failMatchingStatement] },
    )
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    failWhen = undefined
    injected.length = 0
    await harness.truncate()
    const admin = harness.context.sudo()
    const writer = await admin.db.Writer.create({ data: { name: 'w' } })
    for (const title of ['a', 'b']) {
      await admin.db.Article.create({ data: { title, writer: { connect: { id: writer!.id } } } })
    }
    statements.length = 0
  })

  test(
    'is the second statement of the read, after the one an unshaped include issues alone',
    async () => {
      await harness.context.db.Writer.include('articles').all()
      expect(statements.map(isDeclaredFetch)).toEqual([false])
      statements.length = 0
      const [writer] = await harness.context.db.Writer.include('articles', (articles) =>
        articles.where({ title: { equals: 'a' } }),
      ).all()
      expect(statements.map(isShapedMainRead)).toEqual([true, false])
      expect(statements.map(isDeclaredFetch)).toEqual([false, true])
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
          statements.length = 0
          failWhen = isDeclaredFetch
          await tx.db.Writer.include('articles', (articles) =>
            articles.where({ title: { equals: 'a' } }),
          )
            .all()
            .catch((error: unknown) => caught.push(error))
          failWhen = undefined
        })
        .catch((error: unknown) => error)

      expect(injected).toHaveLength(1)
      expect(isDeclaredFetch(injected[0].sql)).toBe(true)
      expect(statements.map(isShapedMainRead)).toEqual([true, false])
      expect(statements.at(-1)).toBe(injected[0].sql)
      expect(caught).toEqual([injected[0]])
      expect(rejection).toBeInstanceOf(TransactionRolledBackError)
      if (rejection instanceof TransactionRolledBackError) expect(rejection.cause).toBe(caught[0])
      const names = (await harness.context.sudo().db.Writer.all()).map((row) => row.name)
      expect(names).toEqual(['w'])
    },
    BOOT,
  )
})
