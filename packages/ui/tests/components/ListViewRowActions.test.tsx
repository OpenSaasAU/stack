// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { AccessContext, OpenSaasConfig, Session } from '@opensaas/stack-core'
import { relationship, text, virtual } from '@opensaas/stack-core/fields'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import { ListView } from '../../src/components/ListView.js'
import { ListViewClient, type ListViewClientProps } from '../../src/components/ListViewClient.js'

vi.mock('next/navigation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation.js')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/post',
  useSearchParams: () => new URLSearchParams(),
}))

const BOOT = 120_000

const isAvailable = vi.fn(
  ({ item }: { item: Record<string, unknown> }) => item.status !== 'published',
)
const handler = vi.fn(async () => ({ message: 'Published' }))

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    User: {
      fields: {
        name: text(),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
      access: { operation: { query: () => true } },
    },
    Post: {
      fields: {
        title: text(),
        status: text(),
        author: relationship({ ref: 'User.posts' }),
      },
      access: { operation: { query: () => true, delete: () => true } },
      ui: {
        listView: {
          rowActions: [
            {
              key: 'publish',
              label: 'Publish now',
              icon: 'send',
              isAvailable,
              handler,
            },
            {
              key: 'feature',
              label: 'Feature',
              hasAccess: ({ session }) => session?.role === 'editor',
              handler,
            },
          ],
        },
      },
    },
  },
}

let database: TestDatabase
const ids: Record<string, string> = {}

function findListViewClientProps(tree: React.ReactElement): ListViewClientProps {
  const outer = tree as React.ReactElement<{ children: React.ReactNode }>
  const client = React.Children.toArray(outer.props.children).find(
    (child): child is React.ReactElement<ListViewClientProps> =>
      React.isValidElement(child) && child.type === ListViewClient,
  )
  if (!client) throw new Error('ListViewClient not found in ListView output')
  return client.props
}

async function render(session: Session | null): Promise<ListViewClientProps> {
  const context = database.context(session) as unknown as AccessContext
  return findListViewClientProps(
    await ListView({ context, config, listKey: 'Post', basePath: '/admin' }),
  )
}

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  await database.truncate()
  isAvailable.mockClear()
  const db = database.context(null).sudo().db
  const author = await db.User.create({ data: { name: 'Ada' } })
  for (const [title, status] of [
    ['Draft one', 'draft'],
    ['Live one', 'published'],
  ]) {
    const post = await db.Post.create({
      data: { title, status, author: { connect: { id: author?.id } } },
    })
    ids[title] = String(post?.id)
  }
})

describe('ListView Row actions', () => {
  it(
    'offers an action only on the rows its isAvailable accepts',
    async () => {
      const props = await render({ userId: 'u1' })

      expect(props.rowActions).toEqual([{ key: 'publish', label: 'Publish now', icon: 'send' }])
      expect(props.rowActionKeys).toEqual({ [ids['Draft one']]: ['publish'] })
    },
    BOOT,
  )

  it(
    'hands isAvailable the row’s own columns and no relation',
    async () => {
      await render({ userId: 'u1' })

      const items = isAvailable.mock.calls.map(([args]) => args.item)
      expect(items).toHaveLength(2)
      for (const item of items) {
        expect(item).toHaveProperty('authorId')
        expect(item).not.toHaveProperty('author')
      }
    },
    BOOT,
  )

  it(
    'drops an action hasAccess denies, and serialises no function',
    async () => {
      const denied = await render({ userId: 'u1' })
      expect(denied.rowActions?.map((action) => action.key)).toEqual(['publish'])

      const editor = await render({ userId: 'u1', role: 'editor' })
      expect(editor.rowActions?.map((action) => action.key)).toEqual(['publish', 'feature'])
      expect(editor.rowActionKeys?.[ids['Live one']]).toEqual(['feature'])
      for (const action of editor.rowActions ?? []) {
        expect(Object.values(action).every((value) => typeof value !== 'function')).toBe(true)
      }
    },
    BOOT,
  )
})

const commentedConfig: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Article: {
      fields: {
        title: text(),
        comments: relationship({ ref: 'Comment.article', many: true }),
        hasComments: virtual({
          type: 'boolean',
          needs: ['comments'],
          hooks: {
            resolveOutput: ({ item }) => Array.isArray(item.comments) && item.comments.length > 0,
          },
        }),
      },
      access: { operation: { query: () => true } },
      ui: {
        listView: {
          rowActions: [
            {
              key: 'moderate',
              label: 'Moderate',
              isAvailable: ({ item }) => item.hasComments === true,
              handler,
            },
            {
              key: 'promote',
              label: 'Promote',
              hasAccess: ({ session }) => {
                if (session === null || typeof session.role !== 'object' || session.role === null)
                  throw new Error('no role')
                return true
              },
              handler,
            },
          ],
        },
      },
    },
    Comment: {
      fields: {
        body: text(),
        article: relationship({ ref: 'Article.comments' }),
      },
      access: { operation: { query: () => true } },
    },
  },
}

describe('ListView Row actions over computed fields', () => {
  let commented: TestDatabase
  const articleIds: Record<string, string> = {}

  async function renderArticles(columns: string[]): Promise<ListViewClientProps> {
    const context = commented.context({ userId: 'u1' }) as unknown as AccessContext
    return findListViewClientProps(
      await ListView({
        context,
        config: commentedConfig,
        listKey: 'Article',
        basePath: '/admin',
        columns,
      }),
    )
  }

  beforeAll(async () => {
    commented = await createTestDatabase(commentedConfig)
    const db = commented.context(null).sudo().db
    for (const title of ['Discussed', 'Quiet']) {
      const article = await db.Article.create({ data: { title } })
      articleIds[title] = String(article?.id)
    }
    await db.Comment.create({
      data: { body: 'first', article: { connect: { id: articleIds.Discussed } } },
    })
  }, BOOT)

  afterAll(async () => {
    await commented?.close()
  })

  it(
    'decides availability from the computed field as dispatch computes it, with a to-many shown as a count',
    async () => {
      const props = await renderArticles(['title', 'comments'])

      expect(props.items.find((item) => item.title === 'Discussed')?.comments).toBe(1)
      expect(props.rowActionKeys).toEqual({ [articleIds.Discussed]: ['moderate'] })
    },
    BOOT,
  )

  it(
    'hides an action whose hasAccess throws instead of failing the list page',
    async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const props = await renderArticles(['title'])

        expect(props.items).toHaveLength(2)
        expect(props.rowActions?.map((action) => action.key)).toEqual(['moderate'])
      } finally {
        logged.mockRestore()
      }
    },
    BOOT,
  )
})
