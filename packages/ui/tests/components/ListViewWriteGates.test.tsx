// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { OpenSaasConfig, Session } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { createTestDatabase, type TestDatabase, untypedRule } from '@opensaas/stack-core/testing'
import { ListView } from '../../src/components/ListView.js'
import { ListViewClient, type ListViewClientProps } from '../../src/components/ListViewClient.js'

vi.mock('next/navigation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation.js')>()),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/note',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const BOOT = 120_000

type RuleArgs = { session: Session | null }

const adminOrNothing = untypedRule(({ session }: RuleArgs) => {
  if (session?.role === 'admin') return true
  return session?.role === 'returns-null' ? null : undefined
})

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Note: {
      fields: { body: text() },
      access: {
        operation: {
          query: () => true,
          create: adminOrNothing,
          update: () => true,
          delete: adminOrNothing,
        },
      },
    },
  },
}

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase(config)
  await database
    .context(null)
    .sudo()
    .db.Note.create({ data: { body: 'A readable note' } })
}, BOOT)

afterAll(async () => {
  await database?.close()
})

async function listView(session: Session) {
  return await ListView({
    context: database.context(session),
    config,
    listKey: 'Note',
    basePath: '/admin',
  })
}

function clientProps(tree: React.ReactElement): ListViewClientProps {
  if (!React.isValidElement<{ children: React.ReactNode }>(tree)) {
    throw new Error('ListView rendered no element')
  }
  const client = React.Children.toArray(tree.props.children).find(
    (child): child is React.ReactElement<ListViewClientProps> =>
      React.isValidElement(child) && child.type === ListViewClient,
  )
  if (!client) throw new Error('ListViewClient not found in ListView output')
  return client.props
}

describe('a readable list view gates create and delete on the Session vocabulary', () => {
  it.each([
    ['null', 'returns-null'],
    ['undefined', 'returns-undefined'],
  ])(
    'offers no Create and no Delete when the rule returns %s',
    async (_label, role) => {
      const tree = await listView({ role })
      const props = clientProps(tree)

      expect(props.canCreate).toBe(false)
      expect(props.canDelete).toBe(false)
      const html = renderToStaticMarkup(tree)
      expect(html).toContain('A readable note')
      expect(html).not.toContain('href="/admin/note/create"')
    },
    BOOT,
  )

  it(
    'offers Create and Delete where the rules allow them',
    async () => {
      const tree = await listView({ role: 'admin' })
      const props = clientProps(tree)

      expect(props.canCreate).toBe(true)
      expect(props.canDelete).toBe(true)
      expect(renderToStaticMarkup(tree)).toContain('href="/admin/note/create"')
    },
    BOOT,
  )
})
