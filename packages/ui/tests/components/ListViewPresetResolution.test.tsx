// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { OpenSaasConfig, Session } from '@opensaas/stack-core'
import { relationship, select, text } from '@opensaas/stack-core/fields'
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
        author: relationship({ ref: 'User.posts' }),
      },
      access: {
        operation: {
          query: ({ session }) =>
            session?.role === 'editor' ? true : { status: { equals: 'published' } },
        },
      },
      ui: {
        listView: {
          presets: [
            {
              key: 'my-drafts',
              label: 'My drafts',
              search: ({ session }) => `status:draft author:"${String(session?.name)}"`,
              sort: { field: 'title', direction: 'desc' },
              hasAccess: ({ session }) => session !== null,
            },
            { key: 'drafts', label: 'Drafts', search: 'status:draft' },
            {
              key: 'mine',
              label: 'Mine',
              search: ({ session }) => `status:draft author:#${String(session?.userId)}`,
              hasAccess: ({ session }) => typeof session?.userId === 'string',
            },
          ],
        },
      },
    },
  },
}

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
      ...props,
    }),
  )
}

const titles = (props: ListViewClientProps) => props.items.map((item) => item.title)

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  await database.truncate()
  const db = database.context(null).sudo().db
  for (const name of ['Ada', 'Grace']) {
    const author = await db.User.create({ data: { name } })
    for (const [title, status] of [
      [`${name} draft A`, 'draft'],
      [`${name} draft B`, 'draft'],
      [`${name} live`, 'published'],
    ]) {
      await db.Post.create({ data: { title, status, author: { connect: { id: author?.id } } } })
    }
  }
})

describe('ListView Preset views', () => {
  it(
    'passes only serialisable tabs the session may see',
    async () => {
      const editor = await render({ role: 'editor', name: 'Ada' })
      expect(editor.presets).toEqual([
        { key: 'my-drafts', label: 'My drafts' },
        { key: 'drafts', label: 'Drafts' },
      ])
      expect(editor.activePreset).toBeUndefined()

      const anonymous = await render(null)
      expect(anonymous.presets).toEqual([{ key: 'drafts', label: 'Drafts' }])
    },
    BOOT,
  )

  it(
    'resolves one ?preset= link against each session',
    async () => {
      const ada = await render({ role: 'editor', name: 'Ada' }, { preset: 'my-drafts' })
      expect(ada.activePreset).toBe('my-drafts')
      expect(ada.search).toBe('status:draft author:"Ada"')
      expect(ada.initialSort).toEqual({ field: 'title', direction: 'desc' })
      expect(titles(ada)).toEqual(['Ada draft B', 'Ada draft A'])

      const grace = await render({ role: 'editor', name: 'Grace' }, { preset: 'my-drafts' })
      expect(titles(grace)).toEqual(['Grace draft B', 'Grace draft A'])
    },
    BOOT,
  )

  it(
    'only narrows what the session may already see',
    async () => {
      const anonymous = await render(null, { preset: 'drafts' })
      expect(anonymous.activePreset).toBe('drafts')
      expect(titles(anonymous)).toEqual([])
      expect(anonymous.total).toBe(0)
    },
    BOOT,
  )

  it(
    'lets an explicit ?sort= win over the preset’s sort',
    async () => {
      const ada = await render(
        { role: 'editor', name: 'Ada' },
        { preset: 'my-drafts', sort: { field: 'title', direction: 'asc' } },
      )
      expect(titles(ada)).toEqual(['Ada draft A', 'Ada draft B'])
    },
    BOOT,
  )

  it(
    'falls back to the plain list for an unknown or denied preset',
    async () => {
      const unknown = await render({ role: 'editor', name: 'Ada' }, { preset: 'nope' })
      expect(unknown.activePreset).toBeUndefined()
      expect(unknown.search).toBeUndefined()
      expect(unknown.total).toBe(6)

      const denied = await render(null, { preset: 'my-drafts' })
      expect(denied.activePreset).toBeUndefined()
      expect(denied.search).toBeUndefined()
      expect(denied.total).toBe(2)
    },
    BOOT,
  )

  it(
    'matches the session’s own records by id, and labels the preset’s id chip',
    async () => {
      const db = database.context(null).sudo().db
      const lovelace = await db.User.create({ data: { name: 'Ada Lovelace' } })
      await db.Post.create({
        data: {
          title: 'Lovelace draft',
          status: 'draft',
          author: { connect: { id: lovelace?.id } },
        },
      })
      const ada = await db.User.where({ name: { equals: 'Ada' } }).first()
      const adaId = String(ada?.id)

      const mine = await render({ role: 'editor', userId: adaId }, { preset: 'mine' })
      expect(mine.activePreset).toBe('mine')
      expect(mine.search).toBe(`status:draft author:#${adaId}`)
      expect(titles(mine).sort()).toEqual(['Ada draft A', 'Ada draft B'])
      expect(mine.recordLabels).toEqual({ author: [{ id: adaId, label: 'Ada' }] })
    },
    BOOT,
  )
})
