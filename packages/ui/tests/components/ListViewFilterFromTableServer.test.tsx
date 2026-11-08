// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { OpenSaasConfig, Session } from '@opensaas/stack-core'
import { integer, relationship, select, text } from '@opensaas/stack-core/fields'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import { ListView, type ListViewProps } from '../../src/components/ListView.js'
import { ListViewClient, type ListViewClientProps } from '../../src/components/ListViewClient.js'

vi.mock('next/navigation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation.js')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/post',
  useSearchParams: () => new URLSearchParams(),
}))

const BOOT = 120_000

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
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
        }),
        views: integer(),
        author: relationship({ ref: 'User.posts' }),
      },
      access: {
        operation: {
          query: ({ session }) =>
            session?.role === 'editor' ? true : { status: { equals: 'published' } },
        },
      },
    },
  },
}

const editor: Session = { role: 'editor' }

let database: TestDatabase

function hasChildren(props: unknown): props is { children: React.ReactNode } {
  return typeof props === 'object' && props !== null && 'children' in props
}

function findListViewClientProps(tree: React.ReactElement): ListViewClientProps {
  if (!hasChildren(tree.props)) throw new Error('ListView output has no children')
  const client = React.Children.toArray(tree.props.children).find(
    (child): child is React.ReactElement<ListViewClientProps> =>
      React.isValidElement(child) && child.type === ListViewClient,
  )
  if (!client) throw new Error('ListViewClient not found in ListView output')
  return client.props
}

async function render(
  session: Session | null,
  props: Partial<ListViewProps> = {},
): Promise<ListViewClientProps> {
  return findListViewClientProps(
    await ListView({
      context: database.context(session),
      config,
      listKey: 'Post',
      basePath: '/admin',
      urlControls: true,
      ...props,
    }),
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
  const db = database.context(null).sudo().db
  const posts: Array<{ title: string; status: string; views: number }> = [
    { title: 'Draft A', status: 'draft', views: 10 },
    { title: 'Draft B', status: 'draft', views: 20 },
    { title: 'Draft C', status: 'draft', views: 30 },
    { title: 'Live A', status: 'published', views: 500 },
    { title: 'Live B', status: 'published', views: 600 },
  ]
  for (const data of posts) await db.Post.create({ data })
})

describe('a filtered field’s column', () => {
  it(
    'is shown for this render when the chosen columns hide it, and never added to ?columns=',
    async () => {
      const props = await render(editor, {
        visibleColumns: ['title'],
        search: 'status:draft views:>15 hello',
      })
      expect(props.columns).toEqual(['title'])
      expect(props.autoColumns).toEqual(['status', 'views'])
      expect(props.columnsChosen).toBe(true)
    },
    BOOT,
  )

  it(
    'is passed apart from the chosen columns, so it never becomes the title column',
    async () => {
      const props = await render(editor, { visibleColumns: ['author'], search: 'status:draft' })
      expect(props.columns).toEqual(['author'])
      expect(props.autoColumns).toEqual(['status'])
    },
    BOOT,
  )

  it(
    'adds nothing for free text or a column already shown',
    async () => {
      const props = await render(editor, {
        visibleColumns: ['title', 'status'],
        search: 'status:draft draft',
      })
      expect(props.columns).toEqual(['title', 'status'])
      expect(props.autoColumns).toEqual([])
    },
    BOOT,
  )
})

describe('the zero-results removal', () => {
  it(
    'names the term whose removal returns the most rows',
    async () => {
      const props = await render(editor, { search: 'status:draft views:>100' })
      expect(props.total).toBe(0)
      expect(props.filterRemoval).toEqual({
        search: 'status:draft views:>100',
        query: 'status:draft',
        sentence: 'Views greater than 100',
        rows: 3,
      })
    },
    BOOT,
  )

  it(
    'counts only rows the session can already see',
    async () => {
      const props = await render(null, { search: 'status:draft views:>100' })
      expect(props.total).toBe(0)
      expect(props.filterRemoval).toEqual({
        search: 'status:draft views:>100',
        query: 'views:>100',
        sentence: 'Status is Draft',
        rows: 2,
      })
    },
    BOOT,
  )

  it(
    'treats a paired range as one term',
    async () => {
      const props = await render(editor, { search: 'views:>=15 views:<=25 status:published' })
      expect(props.total).toBe(0)
      expect(props.filterRemoval).toEqual({
        search: 'views:>=15 views:<=25 status:published',
        query: 'status:published',
        sentence: 'Views between 15 and 25',
        rows: 2,
      })
    },
    BOOT,
  )

  it(
    'is null when no single removal returns rows',
    async () => {
      const props = await render(editor, { search: 'status:draft views:>100 title:zzz' })
      expect(props.total).toBe(0)
      expect(props.filterRemoval).toBeNull()
    },
    BOOT,
  )

  it(
    'counts only the first five terms',
    async () => {
      const props = await render(editor, {
        search: 'status:draft views:<100 title:draft draft views:>0 title:zzz',
      })
      expect(props.total).toBe(0)
      expect(props.filterRemoval).toBeNull()

      const within = await render(editor, {
        search: 'status:draft views:<100 title:draft draft title:zzz',
      })
      expect(within.filterRemoval).toEqual({
        search: 'status:draft views:<100 title:draft draft title:zzz',
        query: 'status:draft views:<100 title:draft draft',
        sentence: 'Title contains zzz',
        rows: 3,
      })
    },
    BOOT,
  )

  it(
    'runs only when the query returns nothing',
    async () => {
      const props = await render(editor, { search: 'status:draft' })
      expect(props.total).toBe(3)
      expect(props.filterRemoval).toBeNull()
    },
    BOOT,
  )
})
