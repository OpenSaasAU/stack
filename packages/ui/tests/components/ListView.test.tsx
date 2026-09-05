import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { text, relationship, select, virtual, timestamp } from '@opensaas/stack-core/fields'
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

function makeContext(delegates: Record<string, DelegateStub>): AccessContext {
  const context = {
    db: delegates,
    session: null,
    storage: {},
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
  }
  return context as unknown as AccessContext
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

  it('resolves a to-many relationship to its access-visible count (issue #732)', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        Tag: list({
          fields: { name: text() },
          access: { operation: { query: () => true } },
        }),
        Post: list({
          fields: {
            title: text(),
            tags: relationship({ ref: 'Tag', many: true }),
          },
        }),
      },
    }

    // The list view fetches a to-many column as a filtered `_count`, not the
    // related rows — the resolved column value is that count, and the raw
    // `_count` payload is dropped before crossing to the client.
    const findMany = vi.fn(async () => [{ id: '1', title: 'Post 1', _count: { tags: 2 } }])
    const context = makeContext({
      post: { findMany, count: vi.fn(async () => 1) },
    })

    const tree = await ListView({ context, config, listKey: 'Post', basePath: '/admin' })
    const props = findListViewClientProps(tree)

    expect(props.items[0].tags).toBe(2)
    expect(props.items[0]._count).toBeUndefined()

    // The to-many relationship was requested as an access-scoped `_count`
    // select, never as a row-fetching include.
    const call = findMany.mock.calls[0]?.[0] as { include?: Record<string, unknown> }
    expect(call.include).toEqual({ _count: { select: { tags: true } } })
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

describe('ListView server-side filtering (filter engine, secured context)', () => {
  const config: OpenSaasConfig = {
    db: { provider: 'sqlite', url: 'file:./test.db' },
    lists: {
      Post: list({
        fields: {
          title: text(),
          status: select({
            options: [
              { label: 'Draft', value: 'draft' },
              { label: 'Published', value: 'published' },
            ],
          }),
        },
      }),
    },
  }

  it('passes a field-token filter (status:Published) to context.db.findMany/count as a where', async () => {
    const findMany = vi.fn(async () => [])
    const count = vi.fn(async () => 0)
    const context = makeContext({ post: { findMany, count } })

    // The URL filter query is the ListView `search` prop.
    await ListView({
      context,
      config,
      listKey: 'Post',
      basePath: '/admin',
      search: 'status:Published',
    })

    // Filtering runs through the secured context.db (never client-side); the
    // engine mapped the select token to an equality on the stored value.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { equals: 'published' } } }),
    )
    expect(count).toHaveBeenCalledWith({ where: { status: { equals: 'published' } } })
  })

  it('maps a bare word to a free-text contains over text fields', async () => {
    const findMany = vi.fn(async () => [])
    const count = vi.fn(async () => 0)
    const context = makeContext({ post: { findMany, count } })

    await ListView({ context, config, listKey: 'Post', basePath: '/admin', search: 'hello' })

    // Only `title` is a text (free-text) field → a single contains condition.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { title: { contains: 'hello' } } }),
    )
  })

  it('passes where: undefined when there is no filter query', async () => {
    const findMany = vi.fn(async () => [])
    const count = vi.fn(async () => 0)
    const context = makeContext({ post: { findMany, count } })

    await ListView({ context, config, listKey: 'Post', basePath: '/admin' })

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }))
  })
})

describe('ListView excludes read-denied fields from filtering/sorting (#915)', () => {
  const config: OpenSaasConfig = {
    db: { provider: 'sqlite', url: 'file:./test.db' },
    lists: {
      Organisation: list({
        fields: {
          name: text(),
          billingAddress: text({ access: { read: () => false } }),
        },
        access: { operation: { query: () => true } },
      }),
    },
  }

  it('drops a read-denied field from the collected filter suggestions', async () => {
    const findMany = vi.fn(async () => [])
    const count = vi.fn(async () => 0)
    const context = makeContext({ organisation: { findMany, count } })

    const tree = await ListView({ context, config, listKey: 'Organisation', basePath: '/admin' })
    const props = findListViewClientProps(tree)

    expect(props.filterSuggestions.map((s) => s.field)).toEqual(['name'])
  })

  it('a `field:value` token for a read-denied field degrades to free text (never reaches context.db)', async () => {
    const findMany = vi.fn(async () => [])
    const count = vi.fn(async () => 0)
    const context = makeContext({ organisation: { findMany, count } })

    await ListView({
      context,
      config,
      listKey: 'Organisation',
      basePath: '/admin',
      search: 'billingAddress:12',
    })

    // Never `{ billingAddress: { contains: '12' } }` — the spec was excluded,
    // so the token falls back to a free-text search over `name`.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: { contains: '12' } } }),
    )
  })

  it('ignores a sort request naming a read-denied field (no orderBy, never reaches Prisma)', async () => {
    const findMany = vi.fn(async () => [])
    const count = vi.fn(async () => 0)
    const context = makeContext({ organisation: { findMany, count } })

    await ListView({
      context,
      config,
      listKey: 'Organisation',
      basePath: '/admin',
      sort: { field: 'billingAddress', direction: 'asc' },
    })

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: undefined }))
  })

  it('leaves a readable field filterable and sortable (no regression)', async () => {
    const findMany = vi.fn(async () => [])
    const count = vi.fn(async () => 0)
    const context = makeContext({ organisation: { findMany, count } })

    const tree = await ListView({
      context,
      config,
      listKey: 'Organisation',
      basePath: '/admin',
      search: 'name:Acme',
      sort: { field: 'name', direction: 'asc' },
    })
    const props = findListViewClientProps(tree)

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: { contains: 'Acme' } },
        orderBy: { name: 'asc' },
      }),
    )
    expect(props.filterSuggestions.map((s) => s.field)).toEqual(['name'])
  })
})

describe('ListView to-many relationship count sort & filter (issue #732)', () => {
  const config: OpenSaasConfig = {
    db: { provider: 'sqlite', url: 'file:./test.db' },
    lists: {
      User: list({
        fields: {
          name: text(),
          fullName: virtual({
            type: 'string',
            hooks: { resolveOutput: ({ item }) => String(item.name ?? '') },
          }),
          posts: relationship({ ref: 'Post.author', many: true }),
        },
        access: { operation: { query: () => true } },
      }),
      Post: list({
        fields: { title: text(), author: relationship({ ref: 'User.posts' }) },
        access: { operation: { query: () => true } },
      }),
    },
  }

  it('sorts a to-many column by its relation _count', async () => {
    const findMany = vi.fn(async () => [])
    const context = makeContext({ user: { findMany, count: vi.fn(async () => 0) } })

    await ListView({
      context,
      config,
      listKey: 'User',
      basePath: '/admin',
      sort: { field: 'posts', direction: 'desc' },
    })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { posts: { _count: 'desc' } } }),
    )
  })

  it('sorts a scalar column by its own value', async () => {
    const findMany = vi.fn(async () => [])
    const context = makeContext({ user: { findMany, count: vi.fn(async () => 0) } })

    await ListView({
      context,
      config,
      listKey: 'User',
      basePath: '/admin',
      sort: { field: 'name', direction: 'asc' },
    })

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { name: 'asc' } }))
  })

  it('ignores a sort on a virtual field (no orderBy, never reaches Prisma)', async () => {
    const findMany = vi.fn(async () => [])
    const context = makeContext({ user: { findMany, count: vi.fn(async () => 0) } })

    await ListView({
      context,
      config,
      listKey: 'User',
      basePath: '/admin',
      sort: { field: 'fullName', direction: 'asc' },
    })

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: undefined }))
  })

  it('resolves a count filter (posts:>5) to an access-scoped id constraint', async () => {
    const rows = [
      { id: 'u1', _count: { posts: 7 } },
      { id: 'u2', _count: { posts: 2 } },
    ]
    const findMany = vi.fn(async () => rows)
    const count = vi.fn(async () => 0)
    const context = makeContext({ user: { findMany, count } })

    await ListView({
      context,
      config,
      listKey: 'User',
      basePath: '/admin',
      search: 'posts:>5',
    })

    // The main query (and its count) is narrowed to the users whose
    // access-visible post count exceeds 5 — only u1.
    const mainCall = findMany.mock.calls.at(-1)?.[0] as { where?: unknown }
    expect(mainCall.where).toEqual({ id: { in: ['u1'] } })
    expect(count).toHaveBeenCalledWith({ where: { id: { in: ['u1'] } } })
  })
})

describe('ListView to-one relationship label filter (issue #749 / #916)', () => {
  // Until #916, ListView folded the related list's `query` access into a
  // to-one relationship label filter's nested `is` clause itself, since the
  // engine did not scope relation filters in `where` at all. #916 moved that
  // scoping into the engine (`buildAccessScopedWhere`, exercised end-to-end
  // in `packages/core/tests/context.test.ts`'s "relation filter access
  // scoping (#916)" suite against the real secured context), so ListView now
  // hands the label filter's `where` to `context.db` UNSCOPED — this mock,
  // standing in for the real access-controlled `context.db`, is not where
  // that scoping happens anymore. These tests pin ListView's own contract:
  // the label filter reaches `context.db` unchanged, access-folding included.
  const config: OpenSaasConfig = {
    db: { provider: 'sqlite', url: 'file:./test.db' },
    lists: {
      User: list({
        fields: { name: text(), active: text() },
        access: { operation: { query: () => ({ active: { equals: 'yes' } }) } },
      }),
      Post: list({
        fields: { title: text(), author: relationship({ ref: 'User.posts' }) },
        access: { operation: { query: () => true } },
      }),
    },
  }

  it('passes a relationship label filter (author:Ada) through to context.db unscoped', async () => {
    const findMany = vi.fn(async () => [])
    const count = vi.fn(async () => 0)
    const context = makeContext({ post: { findMany, count } })

    await ListView({
      context,
      config,
      listKey: 'Post',
      basePath: '/admin',
      search: 'author:Ada',
    })

    const expectedWhere = { author: { is: { name: { contains: 'Ada' } } } }
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }))
    expect(count).toHaveBeenCalledWith({ where: expectedWhere })
  })
})

describe('ListView default-column curation (issue #1018)', () => {
  it("bakes ui.listView.defaultColumn: false into createdAt/updatedAt when the list's timestamps resolve enabled", async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db', timestamps: true },
      lists: {
        Post: list({
          fields: { title: text(), createdAt: timestamp(), updatedAt: timestamp() },
        }),
      },
    }
    const context = makeContext({
      post: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    })

    const tree = await ListView({ context, config, listKey: 'Post', basePath: '/admin' })
    const props = findListViewClientProps(tree)

    expect(props.fields?.createdAt?.ui?.listView?.defaultColumn).toBe(false)
    expect(props.fields?.updatedAt?.ui?.listView?.defaultColumn).toBe(false)
    expect(props.fields?.title?.ui?.listView?.defaultColumn).toBeUndefined()
  })

  it("leaves a field literally named createdAt alone when the list's timestamps are not enabled", async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        Post: list({ fields: { title: text(), createdAt: text() } }),
      },
    }
    const context = makeContext({
      post: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    })

    const tree = await ListView({ context, config, listKey: 'Post', basePath: '/admin' })
    const props = findListViewClientProps(tree)

    expect(props.fields?.createdAt?.ui?.listView?.defaultColumn).toBeUndefined()
  })
})
