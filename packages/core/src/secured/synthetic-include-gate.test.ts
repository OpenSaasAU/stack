import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { text, relationship } from '../fields/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'
import type { OpenSaasConfig } from '../config/types.js'

const BOOT = 120_000

function gatedConfig(read: () => boolean): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Category: {
        fields: { name: text() },
        access: { operation: { query: () => true, create: () => true } },
      },
      Post: {
        fields: {
          title: text(),
          category: relationship({ ref: 'Category', access: { read } }),
        },
        access: { operation: { query: () => true, create: () => true } },
      },
    },
  }
}

describe('synthetic back-relation include honours the source field read gate (#1812)', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(
      gatedConfig(() => false),
      null,
    )
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  test(
    'an include of from_Post_category does not leak the link a read-denied field hides',
    async () => {
      const { db } = harness.context
      const category = await db.Category.create({ data: { name: 'c1' } })
      if (category === null) throw new Error('setup')
      await db.Post.create({ data: { title: 'p1', category: { connect: { id: category.id } } } })

      const rows = await db.Category.include('from_Post_category').all()
      expect(rows).toHaveLength(1)
      expect(JSON.stringify(rows)).not.toContain('p1')
    },
    BOOT,
  )
})
