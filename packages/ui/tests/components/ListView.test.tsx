// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AccessContext, OpenSaasConfig, Session } from '@opensaas/stack-core'
import {
  checkbox,
  json,
  password,
  relationship,
  text,
  timestamp,
  virtual,
} from '@opensaas/stack-core/fields'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import { notFound, redirect } from 'next/navigation.js'
import { ListView } from '../../src/components/ListView.js'
import { ListViewClient, type ListViewClientProps } from '../../src/components/ListViewClient.js'

vi.mock('next/navigation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation.js')>()),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/fragile',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const BOOT = 120_000
const INTERNAL_FAILURE = 'relation "internal_table" does not exist'
let readsFail = false
let controlFlow: () => void = () => undefined

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
    Gadget: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        active: checkbox({ defaultValue: false }),
        meta: json(),
        secret: password(),
      },
      db: { timestamps: false },
      access: { operation: { query: () => true } },
    },
    Gated: {
      fields: {
        title: text({
          access: {
            read: ({ session }) => {
              if (session === null) throw new TypeError('no session to read')
              return true
            },
          },
        }),
      },
      access: { operation: { query: ({ session }) => session !== null } },
    },
    Controlled: {
      fields: { title: text() },
      access: {
        operation: {
          query: () => {
            controlFlow()
            return true
          },
        },
      },
    },
    Fragile: {
      fields: {
        name: text({
          hooks: {
            resolveOutput: ({ value }) => {
              if (readsFail) throw new Error(INTERNAL_FAILURE)
              return value
            },
          },
        }),
      },
      access: { operation: { query: () => true, create: () => true } },
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
  await create('Gadget', { name: 'Anvil', active: true, meta: { a: 1 }, secret: 'hunter2hunter2' })
  await create('Gadget', {
    name: 'Bellows',
    active: false,
    meta: { a: 2 },
    secret: 'hunter3hunter3',
  })
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

describe('ListView page clamping', () => {
  it.each([Number.NaN, 0, -1, 1.5, Number.POSITIVE_INFINITY, 1e22])(
    'renders page 1 for page=%s',
    async (page) => {
      const props = await render(ada, { listKey: 'Post', page })
      expect(props.items).toHaveLength(3)
      expect(props.page).toBe(1)
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
      expect(props.filterSuggestions).toBeDefined()
      expect(props.filterSuggestions!.map((s) => s.field)).not.toContain('billingAddress')
      expect(props.filterSuggestions!.map((s) => s.field)).toContain('name')
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

describe('ListView ?columns= resolution', () => {
  it(
    'shows the chosen columns, in order, and counts a to-many the defaults leave out',
    async () => {
      const props = await render(ada, { listKey: 'User', visibleColumns: ['drafts', 'name'] })
      expect(props.columns).toEqual(['drafts', 'name'])
      expect(props.columnsChosen).toBe(true)
      const byName = Object.fromEntries(props.items.map((item) => [item.name, item]))
      expect(byName.Ada.drafts).toBe(2)
      expect(byName.Grace.drafts).toBe(0)
      expect(byName.Ada.posts).toBeUndefined()
    },
    BOOT,
  )

  it(
    'ignores names the list does not display, falling back to the defaults when none remain',
    async () => {
      const some = await render(ada, { listKey: 'User', visibleColumns: ['nope', 'name', 'name'] })
      expect(some.columns).toEqual(['name'])

      const none = await render(ada, { listKey: 'User', visibleColumns: ['nope', 'constructor'] })
      expect(none.columnsChosen).toBe(false)
      expect(none.columns).toEqual(['name', 'billingAddress', 'fullName', 'posts', 'draftTitles'])
    },
    BOOT,
  )

  it(
    'falls back to the configured columns when nothing valid was chosen',
    async () => {
      const props = await render(ada, {
        listKey: 'User',
        columns: ['name', 'posts'],
        visibleColumns: ['nope'],
      })
      expect(props.columns).toEqual(['name', 'posts'])
      expect(props.columnsChosen).toBe(false)
    },
    BOOT,
  )

  it(
    'still applies Field Visibility to a chosen column',
    async () => {
      const props = await render(ada, {
        listKey: 'User',
        visibleColumns: ['name', 'billingAddress'],
      })
      expect(props.columns).toEqual(['name', 'billingAddress'])
      for (const item of props.items) expect(item.billingAddress ?? null).toBeNull()
    },
    BOOT,
  )

  it(
    'offers every displayable field to the column picker',
    async () => {
      const props = await render(ada, { listKey: 'User' })
      expect(props.availableColumns).toEqual(
        expect.arrayContaining(['name', 'billingAddress', 'posts', 'drafts']),
      )
    },
    BOOT,
  )

  it(
    'marks a chosen column sortable when the read can order by it',
    async () => {
      const props = await render(ada, { listKey: 'User', visibleColumns: ['name', 'drafts'] })
      expect(props.sortableFields).toEqual({ name: true, drafts: false })
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

describe('ListView sorts only by what the read can order by (#2180)', () => {
  it.each([
    ['a boolean column', 'active'],
    ['a json column', 'meta'],
    ['a password', 'secret'],
    ['an unknown field', 'nope'],
    ['an inherited object member', 'constructor'],
    ['the prototype accessor', '__proto__'],
  ])(
    'ignores a ?sort= naming %s and still lists the rows',
    async (_label, field) => {
      const props = await render(ada, { listKey: 'Gadget', sort: { field, direction: 'asc' } })
      expect(props.items.map((item) => item.name).sort()).toEqual(['Anvil', 'Bellows'])
      expect(props.total).toBe(2)
      expect(props.initialSort).toBeUndefined()
    },
    BOOT,
  )

  it.each(['createdAt', 'updatedAt'])(
    'ignores %s on a list without timestamps, wherever it is named',
    async (field) => {
      const sort = { field, direction: 'desc' } as const
      const fromUrl = await render(ada, { listKey: 'Gadget', sort })
      expect(fromUrl.items).toHaveLength(2)
      expect(fromUrl.initialSort).toBeUndefined()

      const fromConfig = await render(ada, { listKey: 'Gadget', initialSort: sort })
      expect(fromConfig.items).toHaveLength(2)

      const asColumn = await render(ada, { listKey: 'Gadget', columns: ['name', field] })
      expect(asColumn.items).toHaveLength(2)
      expect(asColumn.sortableFields).toEqual({ name: true, [field]: false })
    },
    BOOT,
  )

  it(
    'falls back to initialSort, and past one that cannot be ordered either',
    async () => {
      const sort = { field: 'active', direction: 'asc' } as const
      const fallback = await render(ada, {
        listKey: 'Gadget',
        sort,
        initialSort: { field: 'name', direction: 'desc' },
      })
      expect(fallback.items.map((item) => item.name)).toEqual(['Bellows', 'Anvil'])
      expect(fallback.initialSort).toEqual({ field: 'name', direction: 'desc' })

      const neither = await render(ada, { listKey: 'Gadget', sort, initialSort: sort })
      expect(neither.items).toHaveLength(2)
      expect(neither.initialSort).toBeUndefined()
    },
    BOOT,
  )

  it(
    'tells the client which displayed columns sort, one boolean each',
    async () => {
      const props = await render(ada, {
        listKey: 'Gadget',
        columns: ['name', 'active', 'meta', 'secret'],
      })
      expect(props.sortableFields).toEqual({
        name: true,
        active: false,
        meta: false,
        secret: false,
      })
    },
    BOOT,
  )

  it(
    'offers no sort on a to-one, a to-many, a virtual or a read-denied column',
    async () => {
      const user = await render(ada, { listKey: 'User' })
      expect(user.sortableFields).toMatchObject({
        name: true,
        billingAddress: false,
        posts: false,
        fullName: false,
      })
      const post = await render(ada, { listKey: 'Post' })
      expect(post.sortableFields).toMatchObject({ title: true, author: false })
    },
    BOOT,
  )

  it(
    'answers a read-denied field exactly as it answers one the list does not have',
    async () => {
      const denied = await render(ada, {
        listKey: 'User',
        columns: ['name', 'billingAddress'],
        sort: { field: 'billingAddress', direction: 'desc' },
        initialSort: { field: 'name', direction: 'asc' },
      })
      const absent = await render(ada, {
        listKey: 'User',
        columns: ['name', 'nope'],
        sort: { field: 'nope', direction: 'desc' },
        initialSort: { field: 'name', direction: 'asc' },
      })
      expect(denied.items).toEqual(absent.items)
      expect(denied.initialSort).toEqual(absent.initialSort)
      expect(denied.sortableFields?.billingAddress).toBe(absent.sortableFields?.nope)
    },
    BOOT,
  )
})

describe('ListView when the read fails (#2180)', () => {
  async function renderFailedRead(): Promise<string> {
    await create('Fragile', { name: 'Breaks on read' })
    readsFail = true
    try {
      const tree = await ListView({
        context: contextAt(ada),
        config,
        basePath: '/admin',
        listKey: 'Fragile',
      })
      return renderToStaticMarkup(tree)
    } finally {
      readsFail = false
    }
  }

  it(
    'shows an error state in place of the first-run empty state',
    async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const html = await renderFailedRead()
      log.mockRestore()

      expect(html).toContain('role="alert"')
      expect(html).toContain('This list could not be loaded')
      expect(html).toContain('href="/admin/fragile"')
      expect(html).not.toContain('No items yet')
      expect(html).not.toContain('0 items')
      expect(html).not.toContain('Create')
    },
    BOOT,
  )

  it(
    'keeps the cause in the server log and out of the page',
    async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const html = await renderFailedRead()
      const logged = log.mock.calls.flat().map(String).join(' ')
      log.mockRestore()

      expect(logged).toContain(INTERNAL_FAILURE)
      expect(html).not.toContain('internal_table')
    },
    BOOT,
  )

  it(
    'leaves a session denied query empty even when a read rule would throw on it',
    async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const plain = await render(null, { listKey: 'Gated' })
      const searched = await render(null, { listKey: 'Gated', search: 'title:x' })
      const logged = log.mock.calls.length
      log.mockRestore()

      expect(plain.items).toEqual([])
      expect(plain.total).toBe(0)
      expect(plain.filterSuggestions).toEqual([])
      expect(searched.items).toEqual([])
      expect(logged).toBe(0)
    },
    BOOT,
  )

  it.each([
    ['redirect()', () => redirect('/sign-in'), 'NEXT_REDIRECT'],
    ['notFound()', () => notFound(), 'NEXT_HTTP_ERROR_FALLBACK;404'],
  ])(
    'lets %s from an access rule through to Next',
    async (_label, thrower, digest) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      controlFlow = thrower
      try {
        await expect(
          ListView({ context: contextAt(ada), config, basePath: '/admin', listKey: 'Controlled' }),
        ).rejects.toMatchObject({ digest: expect.stringContaining(digest) })
        expect(log).not.toHaveBeenCalled()
      } finally {
        controlFlow = () => undefined
        log.mockRestore()
      }
    },
    BOOT,
  )

  it(
    'leaves a session denied query on the empty value, which is not a failure',
    async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const props = await render(ada, { listKey: 'Vault' })
      const logged = log.mock.calls.length
      log.mockRestore()

      expect(props.items).toEqual([])
      expect(props.total).toBe(0)
      expect(logged).toBe(0)
    },
    BOOT,
  )
})
