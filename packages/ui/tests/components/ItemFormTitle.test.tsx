import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { ItemForm } from '../../src/components/ItemForm.js'
import { PageHeader, type PageHeaderProps } from '../../src/components/PageHeader.js'

vi.mock('next/navigation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation.js')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Post: list({
      fields: { title: text(), author: relationship({ ref: 'Author.posts' }) },
      access: { operation: OPEN },
    }),
    Author: list({
      fields: { name: text(), posts: relationship({ ref: 'Post.author', many: true }) },
      access: { operation: OPEN },
    }),
    Note: list({
      fields: { title: text() },
      access: { operation: OPEN },
      ui: { itemView: { defaultFieldMode: 'read' } },
    }),
  },
}

let harness: TestContext
let context: AccessContext
const ids: Record<string, string> = {}

beforeAll(async () => {
  harness = await createTestContext(config, { userId: 'admin' })
  context = harness.context as unknown as AccessContext
  const db = harness.context.db
  ids.author = String((await db.Author.create({ data: { name: 'Priya Nair' } }))?.id)
  ids.post = String(
    (
      await db.Post.create({
        data: { title: 'Hello world', author: { connect: { id: ids.author } } },
      })
    )?.id,
  )
  ids.note = String((await db.Note.create({ data: { title: 'Read me' } }))?.id)
}, BOOT)

afterAll(async () => {
  await harness?.close()
})

type ServerElement = React.ReactElement<Record<string, unknown>> & {
  type: (props: Record<string, unknown>) => unknown
}

function isServerElement(node: unknown): node is ServerElement {
  return React.isValidElement(node) && typeof node.type === 'function'
}

async function resolveServer(node: React.ReactElement): Promise<React.ReactElement> {
  if (!isServerElement(node)) return node
  const output = node.type(node.props)
  if (!(output instanceof Promise)) return node
  const resolved: unknown = await output
  return React.isValidElement(resolved) ? resolveServer(resolved) : node
}

function findPageHeader(node: React.ReactNode): PageHeaderProps | undefined {
  for (const child of React.Children.toArray(node)) {
    if (React.isValidElement<PageHeaderProps>(child) && child.type === PageHeader) {
      return child.props
    }
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) continue
    const found = findPageHeader(child.props.children)
    if (found) return found
  }
  return undefined
}

async function page(listKey: string, mode: 'create' | 'edit', itemId?: string) {
  render(
    await resolveServer(
      await ItemForm({
        context,
        config,
        listKey,
        mode,
        itemId,
        basePath: '/admin',
        serverAction: harness.context.serverAction,
      }),
    ),
  )
}

describe('the item page names its record', () => {
  it(
    'titles an edit page with the item, and the list as context',
    async () => {
      await page('Post', 'edit', ids.post)

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello world')
      expect(screen.queryByText('Edit Post')).not.toBeInTheDocument()
      expect(screen.getByText('Post', { selector: 'p' })).toBeInTheDocument()
    },
    BOOT,
  )

  it(
    'titles an item with a relationship table the same way',
    async () => {
      const tree = await resolveServer(
        await ItemForm({
          context,
          config,
          listKey: 'Author',
          mode: 'edit',
          itemId: ids.author,
          basePath: '/admin',
          serverAction: harness.context.serverAction,
        }),
      )
      const header = findPageHeader(tree)

      expect(header?.title).toBe('Priya Nair')
      expect(header?.description).toBe('Author')
    },
    BOOT,
  )

  it(
    'does not call a read-only page an edit',
    async () => {
      await page('Note', 'edit', ids.note)

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Read me')
      expect(screen.queryByText(/Edit/)).not.toBeInTheDocument()
    },
    BOOT,
  )

  it(
    'keeps "Create Post" on the create page',
    async () => {
      await page('Post', 'create')

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create Post')
    },
    BOOT,
  )

  it(
    'names the item in the delete confirmation',
    async () => {
      await page('Post', 'edit', ids.post)
      await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

      const dialog = await screen.findByRole('dialog')
      expect(
        within(dialog).getByText(
          '“Hello world” will be permanently deleted. This cannot be undone.',
        ),
      ).toBeInTheDocument()
    },
    BOOT,
  )
})
