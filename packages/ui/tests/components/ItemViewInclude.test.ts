import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import {
  composeItemViewRead,
  readAccessScopedTotal,
  sectionRows,
} from '../../src/components/ItemForm.js'
import { deriveItemViewLayout, DEFAULT_ITEM_VIEW_TAKE } from '../../src/lib/deriveItemView.js'

/**
 * The item view's bounded fetch and its access-scoped footer (issue #752), on
 * the read the component actually issues.
 *
 * `Post` is readable only when published and `Secret` is closed outright, so a
 * total that counted past either would be visible here as a number larger than
 * the rows the same read returned.
 */

const BOOT = 120_000

function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      User: {
        fields: {
          name: text(),
          posts: relationship({ ref: 'Post.author', many: true }),
          secrets: relationship({ ref: 'Secret.owner', many: true }),
        },
        access: { operation: { query: () => true, create: () => true } },
      },
      Post: {
        fields: {
          title: text(),
          status: text(),
          author: relationship({ ref: 'User.posts' }),
          category: relationship({ ref: 'Category' }),
        },
        access: {
          operation: { query: () => ({ status: { equals: 'published' } }), create: () => true },
        },
      },
      Category: {
        fields: { name: text() },
        access: { operation: { query: () => true, create: () => true } },
      },
      Secret: {
        fields: { body: text(), owner: relationship({ ref: 'User.secrets' }) },
        access: { operation: { create: () => true } },
      },
    },
  }
}

describe('the item view read', () => {
  let harness: TestContext
  let userId: string

  beforeAll(async () => {
    harness = await createTestContext(makeConfig(), null)

    const sudo = harness.context.sudo()
    const user = await sudo.db.User.create({ data: { name: 'ada' } })
    userId = String(user?.id)
    const category = await sudo.db.Category.create({ data: { name: 'notes' } })

    for (let index = 0; index < DEFAULT_ITEM_VIEW_TAKE + 3; index += 1) {
      await sudo.db.Post.create({
        data: {
          title: `published ${index}`,
          status: 'published',
          author: { connect: { id: user?.id } },
          category: { connect: { id: category?.id } },
        },
      })
    }
    await sudo.db.Post.create({
      data: { title: 'draft', status: 'draft', author: { connect: { id: user?.id } } },
    })
    await sudo.db.Secret.create({
      data: { body: 'hidden', owner: { connect: { id: user?.id } } },
    })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  async function readUser(): Promise<Record<string, unknown>> {
    const config = makeConfig()
    const layout = deriveItemViewLayout(config, 'User')
    const context = harness.context as unknown as AccessContext
    const row = await composeItemViewRead(
      context.db.User.where({ id: userId }),
      config.lists.User,
      layout,
    ).first()
    if (!row) throw new Error('the item view read returned nothing')
    return row
  }

  it(
    'bounds the rows it renders and still reports the full readable total',
    async () => {
      const row = await readUser()

      expect(sectionRows(row.posts)).toHaveLength(DEFAULT_ITEM_VIEW_TAKE)
      // Every published post, and not the draft: the bound shapes the page, the
      // access rule shapes the total.
      expect(readAccessScopedTotal(row.posts, sectionRows(row.posts).length)).toBe(
        DEFAULT_ITEM_VIEW_TAKE + 3,
      )
    },
    BOOT,
  )

  it(
    'reports no total at all for a relation the session may not read',
    async () => {
      const row = await readUser()

      expect(sectionRows(row.secrets)).toEqual([])
      // The fallback is the bounded row count. A denied relation must not put a
      // true total in its place — that is the leak the footer exists to avoid.
      expect(readAccessScopedTotal(row.secrets, 0)).toBe(0)
    },
    BOOT,
  )

  it(
    'honours a per-relationship take override',
    async () => {
      const config = makeConfig()
      const posts = config.lists.User.fields.posts
      config.lists.User.fields.posts = { ...posts, ui: { itemView: { take: 3 } } }

      const layout = deriveItemViewLayout(config, 'User')
      const context = harness.context as unknown as AccessContext
      const row = await composeItemViewRead(
        context.db.User.where({ id: userId }),
        config.lists.User,
        layout,
      ).first()

      expect(sectionRows(row?.posts)).toHaveLength(3)
      expect(readAccessScopedTotal(row?.posts, 3)).toBe(DEFAULT_ITEM_VIEW_TAKE + 3)
    },
    BOOT,
  )
})
