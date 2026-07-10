import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { text, relationship } from '@opensaas/stack-core/fields'
import { ListView } from '../../src/components/ListView.js'
import { ListViewClient, type ListViewClientProps } from '../../src/components/ListViewClient.js'

// Mock Next.js navigation/link — ListViewClient (rendered inside ListView's
// tree) calls useRouter(), and ListView itself renders a Link.
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

interface DelegateStub {
  findMany?: (args: unknown) => Promise<Array<Record<string, unknown>>>
  count?: (args: unknown) => Promise<number>
}

function makeContext(delegates: Record<string, DelegateStub>): AccessContext<unknown> {
  const context = {
    db: delegates,
    session: null,
    storage: {},
    plugins: {},
    _isSudo: false,
    _resolveOutputCounter: { depth: 0 },
  }
  return context as unknown as AccessContext<unknown>
}

/**
 * ListView returns `<div className="p-8">{header}<ListViewClient ... /></div>`.
 * Drill into it to recover the props passed to `ListViewClient` so we can
 * assert on the resolved relationship values without rendering to the DOM.
 */
function findListViewClientProps(tree: React.ReactElement): ListViewClientProps {
  const outer = tree as React.ReactElement<{ children: React.ReactNode }>
  const children = React.Children.toArray(outer.props.children)
  const client = children.find(
    (child): child is React.ReactElement<ListViewClientProps> =>
      React.isValidElement(child) && child.type === ListViewClient,
  )
  if (!client) throw new Error('ListViewClient not found in ListView output')
  return client.props
}

describe('ListView relationship label resolution (shared label seam)', () => {
  it('resolves a relationship value to { id, label } via getItemLabel, defaulting to "name"', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        User: list({ fields: { name: text() } }),
        Post: list({
          fields: {
            title: text(),
            author: relationship({ ref: 'User.posts' }),
          },
        }),
      },
    }

    const context = makeContext({
      post: {
        findMany: vi.fn(async () => [
          { id: '1', title: 'Post 1', author: { id: 'user-1', name: 'Ada Lovelace' } },
        ]),
        count: vi.fn(async () => 1),
      },
    })

    const tree = await ListView({ context, config, listKey: 'Post', basePath: '/admin' })
    const props = findListViewClientProps(tree)

    expect(props.items[0].author).toEqual({ id: 'user-1', label: 'Ada Lovelace' })
  })

  it('honours a configured ui.labelField on the related list', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        User: list({
          fields: { name: text(), email: text() },
          ui: { labelField: 'email' },
        }),
        Post: list({
          fields: {
            title: text(),
            author: relationship({ ref: 'User.posts' }),
          },
        }),
      },
    }

    const context = makeContext({
      post: {
        findMany: vi.fn(async () => [
          {
            id: '1',
            title: 'Post 1',
            author: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
          },
        ]),
        count: vi.fn(async () => 1),
      },
    })

    const tree = await ListView({ context, config, listKey: 'Post', basePath: '/admin' })
    const props = findListViewClientProps(tree)

    expect(props.items[0].author).toEqual({ id: 'user-1', label: 'ada@example.com' })
  })

  it('resolves a many relationship to an array of { id, label } pairs', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        Tag: list({ fields: { name: text() } }),
        Post: list({
          fields: {
            title: text(),
            tags: relationship({ ref: 'Tag', many: true }),
          },
        }),
      },
    }

    const context = makeContext({
      post: {
        findMany: vi.fn(async () => [
          {
            id: '1',
            title: 'Post 1',
            tags: [
              { id: 'tag-1', name: 'JavaScript' },
              { id: 'tag-2', name: 'TypeScript' },
            ],
          },
        ]),
        count: vi.fn(async () => 1),
      },
    })

    const tree = await ListView({ context, config, listKey: 'Post', basePath: '/admin' })
    const props = findListViewClientProps(tree)

    expect(props.items[0].tags).toEqual([
      { id: 'tag-1', label: 'JavaScript' },
      { id: 'tag-2', label: 'TypeScript' },
    ])
  })

  it('falls back to id when the related row is missing the label field (e.g. stripped by access control)', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        User: list({ fields: { name: text() } }),
        Post: list({
          fields: {
            title: text(),
            author: relationship({ ref: 'User.posts' }),
          },
        }),
      },
    }

    const context = makeContext({
      post: {
        findMany: vi.fn(async () => [{ id: '1', title: 'Post 1', author: { id: 'user-1' } }]),
        count: vi.fn(async () => 1),
      },
    })

    const tree = await ListView({ context, config, listKey: 'Post', basePath: '/admin' })
    const props = findListViewClientProps(tree)

    expect(props.items[0].author).toEqual({ id: 'user-1', label: 'user-1' })
  })

  it('resolves an empty/null relationship to null, preserving the dash rendered downstream', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        User: list({ fields: { name: text() } }),
        Post: list({
          fields: {
            title: text(),
            author: relationship({ ref: 'User.posts' }),
          },
        }),
      },
    }

    const context = makeContext({
      post: {
        findMany: vi.fn(async () => [{ id: '1', title: 'Post 1', author: null }]),
        count: vi.fn(async () => 1),
      },
    })

    const tree = await ListView({ context, config, listKey: 'Post', basePath: '/admin' })
    const props = findListViewClientProps(tree)

    expect(props.items[0].author).toBeNull()
  })
})
