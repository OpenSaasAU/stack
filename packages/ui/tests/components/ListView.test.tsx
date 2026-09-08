// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { AccessContext, OpenSaasConfig, Session } from '@opensaas/stack-core'
import { checkbox, relationship, text, timestamp, virtual } from '@opensaas/stack-core/fields'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import { ListView } from '../../src/components/ListView.js'
import { ListViewClient, type ListViewClientProps } from '../../src/components/ListViewClient.js'

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const BOOT = 120_000

function titlesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row: unknown) =>
    typeof row === 'object' && row !== null && 'title' in row ? [String(row.title)] : [],
  )
}

/**
 * One fixture carrying every shape the list view has to answer for: a to-one
 * relation read for its label, a related list with a configured label field, a
 * to-many counted per row, a to-many the view does not display that a computed
 * field declares a dependency on, a list whose `query` access narrows by
 * session, a list denied outright, and a field the session may not read.
 */
const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    User: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        billingAddress: text({ access: { read: () => false } }),
        fullName: virtual({
          type: 'string',
          hooks: { resolveOutput: ({ item }) => String(item.name ?? '') },
        }),
        posts: relationship({ ref: 'Post.author', many: true }),
        drafts: relationship({
          ref: 'Draft.owner',
          many: true,
          ui: { listView: { defaultColumn: false } },
        }),
        draftTitles: virtual({
          type: 'string',
          needs: ['drafts'],
          hooks: { resolveOutput: ({ item }) => titlesOf(item.drafts).sort().join(',') },
        }),
      },
      access: { operation: { query: () => true } },
    },
    Draft: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        owner: relationship({ ref: 'User.drafts' }),
      },
      access: { operation: { query: () => true } },
    },
    Editor: {
      fields: {
        name: text(),
        email: text(),
        posts: relationship({ ref: 'Post.editor', many: true }),
      },
      ui: { labelField: 'email' },
      access: { operation: { query: () => true } },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        published: checkbox({ defaultValue: false }),
        author: relationship({ ref: 'User.posts' }),
        editor: relationship({ ref: 'Editor.posts' }),
        vault: relationship({ ref: 'Vault.posts' }),
      },
      access: {
        operation: {
          query: ({ session }) =>
            typeof session?.userId === 'string' ? true : { published: { equals: true } },
        },
      },
    },
    // Declares no rule, so `query` is denied by default.
    Vault: {
      fields: {
        note: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.vault', many: true }),
      },
    },
  },
}

let database: TestDatabase
let ada: Session = {}

/**
 * ListView returns `<div className="p-8">{header}<ListViewClient ... /></div>`.
 * Drill into it to recover the props passed to `ListViewClient`.
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

/** The context the list view takes — the Test context's own, at `session`. */
function contextAt(session: Session | null): AccessContext {
  return database.context(session) as unknown as AccessContext
}

async function render(
  session: Session | null,
  props: Omit<Parameters<typeof ListView>[0], 'context' | 'config' | 'basePath'>,
): Promise<ListViewClientProps> {
  return findListViewClientProps(
    await ListView({ context: contextAt(session), config, basePath: '/admin', ...props }),
  )
}

async function create(
  listKey: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const created = await database.context(null).sudo().db[listKey].create({ data })
  if (!created) throw new Error(`seeding ${listKey} was denied`)
  return created
}

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  await database.truncate()
  const author = await create('User', { name: 'Ada', billingAddress: '12 Analytical Way' })
  ada = { userId: author.id }
  await create('User', { name: 'Grace' })
  const editor = await create('Editor', { name: 'Editor', email: 'editor@example.com' })
  const vault = await create('Vault', { note: 'sealed' })
  await create('Post', {
    title: 'On Engines',
    published: true,
    author: { connect: { id: author.id } },
    editor: { connect: { id: editor.id } },
    vault: { connect: { id: vault.id } },
  })
  await create('Post', {
    title: 'On Looms',
    published: true,
    author: { connect: { id: author.id } },
  })
  await create('Post', { title: 'Unfinished', published: false })
  await create('Draft', { title: 'Notes', owner: { connect: { id: author.id } } })
  await create('Draft', { title: 'Sketches', owner: { connect: { id: author.id } } })
})

describe('ListView relationship label resolution (shared label seam)', () => {
  it(
    'resolves a to-one relationship to { id, label }, defaulting to "name"',
    async () => {
      const props = await render(ada, { listKey: 'Post', search: 'title:Engines' })
      expect(props.items[0].author).toEqual({ id: String(ada.userId), label: 'Ada' })
    },
    BOOT,
  )

  it(
    'honours a configured ui.labelField on the related list',
    async () => {
      const props = await render(ada, { listKey: 'Post', search: 'title:Engines' })
      expect(props.items[0].editor).toMatchObject({ label: 'editor@example.com' })
    },
    BOOT,
  )

  it(
    'resolves an absent to-one relationship to null, preserving the dash rendered downstream',
    async () => {
      const props = await render(ada, { listKey: 'Post', search: 'title:Looms' })
      expect(props.items[0].editor).toBeNull()
    },
    BOOT,
  )

  it(
    'resolves a to-many relationship to its access-visible count, through the native reducer',
    async () => {
      const props = await render(ada, { listKey: 'User' })
      const byName = Object.fromEntries(props.items.map((item) => [item.name, item]))
      expect(byName.Ada.posts).toBe(2)
      expect(byName.Grace.posts).toBe(0)
      expect(byName.Ada._count).toBeUndefined()
    },
    BOOT,
  )

  it(
    'leaves a to-many the view does not display unreduced, so a computed field over it still sees its rows',
    async () => {
      const props = await render(ada, { listKey: 'User' })
      const byName = Object.fromEntries(props.items.map((item) => [item.name, item]))
      expect(byName.Ada.draftTitles).toBe('Notes,Sketches')
      expect(byName.Grace.draftTitles).toBe('')
      // Undisplayed, so its rows never cross the server/client boundary either.
      expect(byName.Ada.drafts).toBeUndefined()
    },
    BOOT,
  )
})

describe('ListView total (aggregate over the scoped read)', () => {
  it(
    'the total equals the count of rows the session may see',
    async () => {
      const anonymous = await render(null, { listKey: 'Post' })
      expect(anonymous.total).toBe(2)
      expect(anonymous.items).toHaveLength(2)

      const authored = await render(ada, { listKey: 'Post' })
      expect(authored.total).toBe(3)
      expect(authored.items).toHaveLength(3)
    },
    BOOT,
  )

  it(
    'the total counts the whole scoped read, not the page',
    async () => {
      const firstPage = await render(ada, { listKey: 'Post', pageSize: 1 })
      expect(firstPage.items).toHaveLength(1)
      expect(firstPage.total).toBe(3)
    },
    BOOT,
  )
})

describe('ListView server-side filtering (filter engine over the secured surface)', () => {
  it(
    'matches a text token case-insensitively: name:ada finds Ada',
    async () => {
      const props = await render(ada, { listKey: 'User', search: 'name:ada' })
      expect(props.items.map((item) => item.name)).toEqual(['Ada'])
      expect(props.total).toBe(1)
    },
    BOOT,
  )

  it(
    'maps a bare word to a free-text search across the list',
    async () => {
      const props = await render(ada, { listKey: 'User', search: 'GRACE' })
      expect(props.items.map((item) => item.name)).toEqual(['Grace'])
    },
    BOOT,
  )

  it(
    'filters by a to-one label through the relation',
    async () => {
      const props = await render(ada, { listKey: 'Post', search: 'author:ada' })
      expect(props.items.map((item) => item.title).sort()).toEqual(['On Engines', 'On Looms'])
    },
    BOOT,
  )

  it(
    'returns no rows and no error for a relationship filter over a list the session cannot query',
    async () => {
      const props = await render(ada, { listKey: 'Post', search: 'vault:sealed' })
      expect(props.items).toEqual([])
      expect(props.total).toBe(0)
    },
    BOOT,
  )
})

describe('ListView excludes read-denied fields from filtering and sorting (#915)', () => {
  it(
    'drops a read-denied field from the collected filter suggestions',
    async () => {
      const props = await render(ada, { listKey: 'User' })
      expect(props.filterSuggestions.map((s) => s.field)).not.toContain('billingAddress')
      expect(props.filterSuggestions.map((s) => s.field)).toContain('name')
    },
    BOOT,
  )

  it(
    'degrades a `field:value` token for a read-denied field to free text',
    async () => {
      // Never `{ billingAddress: { contains: 'Analytical' } }` — the spec was
      // excluded, so the token falls back to a free-text search over `name`,
      // which matches no user.
      const props = await render(ada, { listKey: 'User', search: 'billingAddress:Analytical' })
      expect(props.items).toEqual([])
    },
    BOOT,
  )

  it(
    'ignores a sort request naming a read-denied field',
    async () => {
      const props = await render(ada, {
        listKey: 'User',
        sort: { field: 'billingAddress', direction: 'asc' },
      })
      expect(props.items.map((item) => item.name).sort()).toEqual(['Ada', 'Grace'])
      expect(props.initialSort).toBeUndefined()
    },
    BOOT,
  )

  it(
    'leaves a readable scalar field filterable and sortable',
    async () => {
      const props = await render(ada, {
        listKey: 'User',
        sort: { field: 'name', direction: 'desc' },
      })
      expect(props.items.map((item) => item.name)).toEqual(['Grace', 'Ada'])
      expect(props.initialSort).toEqual({ field: 'name', direction: 'desc' })
    },
    BOOT,
  )
})

describe('ListView to-many relationship count: presence filter, no count sort (ADR-0055)', () => {
  it(
    'ignores a sort naming a to-many count while the count column still displays',
    async () => {
      const props = await render(ada, {
        listKey: 'User',
        sort: { field: 'posts', direction: 'desc' },
      })
      expect(props.initialSort).toBeUndefined()
      const byName = Object.fromEntries(props.items.map((item) => [item.name, item]))
      expect(byName.Ada.posts).toBe(2)
      expect(byName.Grace.posts).toBe(0)
    },
    BOOT,
  )

  it(
    'ignores a sort on a virtual field',
    async () => {
      const props = await render(ada, {
        listKey: 'User',
        sort: { field: 'fullName', direction: 'asc' },
      })
      expect(props.initialSort).toBeUndefined()
      expect(props.items).toHaveLength(2)
    },
    BOOT,
  )

  it(
    'shrinks a count filter to presence',
    async () => {
      expect(
        (await render(ada, { listKey: 'User', search: 'posts:>0' })).items.map((i) => i.name),
      ).toEqual(['Ada'])
      expect(
        (await render(ada, { listKey: 'User', search: 'posts:0' })).items.map((i) => i.name),
      ).toEqual(['Grace'])
    },
    BOOT,
  )

  it(
    'degrades any other count comparison to free text rather than breaking the page',
    async () => {
      // Prisma 8 cannot compare a relation count in a `where`, so a bookmarked
      // `posts:>5` is searched as the free text `5` instead of erroring.
      const props = await render(ada, { listKey: 'User', search: 'posts:>5' })
      expect(props.items).toEqual([])
      expect(props.total).toBe(0)
    },
    BOOT,
  )
})

describe('ListView default-column curation (issue #1018)', () => {
  const timestamped: OpenSaasConfig = {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Post: {
        fields: { title: text(), createdAt: timestamp(), updatedAt: timestamp() },
        access: { operation: { query: () => true } },
      },
    },
  }

  it(
    "bakes ui.listView.defaultColumn: false into createdAt/updatedAt when the list's timestamps resolve enabled",
    async () => {
      const props = findListViewClientProps(
        await ListView({
          context: contextAt(null),
          config: timestamped,
          listKey: 'Post',
          basePath: '/admin',
        }),
      )
      expect(props.fields?.createdAt?.ui?.listView?.defaultColumn).toBe(false)
      expect(props.fields?.updatedAt?.ui?.listView?.defaultColumn).toBe(false)
      expect(props.fields?.title?.ui?.listView?.defaultColumn).toBeUndefined()
    },
    BOOT,
  )

  it(
    "leaves a field literally named createdAt alone when the list's timestamps are not enabled",
    async () => {
      const untimestamped: OpenSaasConfig = {
        db: { provider: 'postgresql' },
        lists: {
          Post: {
            fields: { title: text(), createdAt: text() },
            access: { operation: { query: () => true } },
          },
        },
      }
      const props = findListViewClientProps(
        await ListView({
          context: contextAt(null),
          config: untimestamped,
          listKey: 'Post',
          basePath: '/admin',
        }),
      )
      expect(props.fields?.createdAt?.ui?.listView?.defaultColumn).toBeUndefined()
    },
    BOOT,
  )
})
