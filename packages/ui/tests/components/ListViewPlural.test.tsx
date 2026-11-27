// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import { ListView } from '../../src/components/ListView.js'
import { ListViewClient, type ListViewClientProps } from '../../src/components/ListViewClient.js'

vi.mock('next/navigation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation.js')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const BOOT = 120_000
const OPEN = { query: () => true, delete: () => true }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Person: { fields: { name: text() }, access: { operation: OPEN }, ui: { plural: 'People' } },
    Category: { fields: { name: text() }, access: { operation: OPEN } },
  },
}

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

function hasChildren(props: unknown): props is { children: React.ReactNode } {
  return typeof props === 'object' && props !== null && 'children' in props
}

async function clientProps(listKey: string): Promise<ListViewClientProps> {
  const tree = await ListView({
    context: database.context({ userId: 'a' }),
    config,
    listKey,
    basePath: '/admin',
    serverAction: async () => null,
  })
  if (!hasChildren(tree.props)) throw new Error('ListView output has no children')
  const client = React.Children.toArray(tree.props.children).find(
    (child): child is React.ReactElement<ListViewClientProps> =>
      React.isValidElement(child) && child.type === ListViewClient,
  )
  if (!client) throw new Error('ListViewClient not found')
  return client.props
}

describe('a list’s plural reaches the list view', () => {
  it(
    'passes ui.plural, and nothing when the list declares none',
    async () => {
      expect((await clientProps('Person')).pluralLabel).toBe('People')
      expect((await clientProps('Category')).pluralLabel).toBeUndefined()
    },
    BOOT,
  )
})
