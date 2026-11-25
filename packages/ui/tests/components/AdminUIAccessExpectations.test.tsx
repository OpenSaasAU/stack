import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { AdminShell } from '../../src/components/AdminShell.js'
import { AdminUI } from '../../src/components/AdminUI.js'
import { Dashboard } from '../../src/components/Dashboard.js'
import { ItemForm } from '../../src/components/ItemForm.js'

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin',
  redirect: vi.fn(),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Post: list({
      fields: { title: text() },
      db: { idField: 'int autoincrement' },
      access: {
        operation: {
          query: () => ({ title: { equals: 'visible' } }),
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
    }),
    Inbox: list({
      fields: { body: text() },
      access: { operation: { query: () => false, create: () => true } },
    }),
    Archive: list({
      fields: { note: text() },
      access: { operation: { query: () => true, create: () => false } },
    }),
  },
}

let harness: TestContext
let context: AccessContext
let hiddenId: number

beforeAll(async () => {
  harness = await createTestContext(config, { userId: 'editor' })
  context = harness.context as unknown as AccessContext
  const hidden = await harness.context.sudo().db.Post.create({ data: { title: 'hidden' } })
  hiddenId = Number(hidden?.id)
}, BOOT)

afterAll(async () => {
  await harness?.close()
})

function sidebarOf(tree: React.ReactNode): React.ReactNode {
  const fragment = tree as React.ReactElement<{ children: React.ReactNode }>
  const shell = React.Children.toArray(fragment.props.children).find(
    (child): child is React.ReactElement<{ sidebar: React.ReactNode }> =>
      React.isValidElement(child) && child.type === AdminShell,
  )
  if (!shell) throw new Error('AdminShell not found')
  return shell.props.sidebar
}

describe('lists the session cannot query', () => {
  it(
    'are left out of the sidebar',
    async () => {
      const tree = await AdminUI({
        context,
        config,
        params: [],
        basePath: '/admin',
        serverAction: harness.context.serverAction,
      })
      render(<>{sidebarOf(tree)}</>)

      expect(screen.getByRole('link', { name: /^Post/ })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /^Archive/ })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /^Inbox/ })).not.toBeInTheDocument()
    },
    BOOT,
  )

  it(
    'are left out of the Dashboard cards and Quick Actions',
    async () => {
      render(await Dashboard({ context, config, basePath: '/admin' }))

      expect(screen.getByRole('link', { name: /^Post/ })).toHaveTextContent('0 items')
      expect(screen.queryByRole('link', { name: /^Inbox/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Create Inbox' })).not.toBeInTheDocument()
    },
    BOOT,
  )
})

describe('Quick Actions', () => {
  it(
    'offers Create only for lists the session may create in',
    async () => {
      render(await Dashboard({ context, config, basePath: '/admin' }))

      expect(screen.getByRole('link', { name: 'Create Post' })).toHaveAttribute(
        'href',
        '/admin/post/create',
      )
      expect(screen.queryByRole('link', { name: 'Create Archive' })).not.toBeInTheDocument()
    },
    BOOT,
  )
})

describe('an item the session cannot see', () => {
  async function editPage(itemId: number) {
    const { container } = render(
      await ItemForm({
        context,
        config,
        listKey: 'Post',
        mode: 'edit',
        itemId,
        basePath: '/admin',
        serverAction: harness.context.serverAction,
      }),
    )
    const text = container.textContent ?? ''
    container.remove()
    return text
  }

  it(
    'reads exactly like an item that does not exist',
    async () => {
      const forbidden = await editPage(hiddenId)
      const missing = await editPage(hiddenId + 1000)

      expect(forbidden).toContain('Item not found')
      expect(forbidden).toBe(missing)
    },
    BOOT,
  )
})

describe('create without create access', () => {
  it(
    "says the list can't be created here, with a way back",
    async () => {
      render(
        await ItemForm({
          context,
          config,
          listKey: 'Archive',
          mode: 'create',
          basePath: '/admin',
          serverAction: harness.context.serverAction,
        }),
      )

      expect(screen.getByText("Archive can't be created here.")).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Back to Archive/ })).toHaveAttribute(
        'href',
        '/admin/archive',
      )
      expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument()
    },
    BOOT,
  )
})
