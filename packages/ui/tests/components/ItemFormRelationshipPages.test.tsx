import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { ItemForm } from '../../src/components/ItemForm.js'
import {
  RelationshipTable,
  type RelationshipTableProps,
} from '../../src/components/RelationshipTable.js'

vi.mock('next/navigation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation.js')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Author: list({
      fields: { name: text(), posts: relationship({ ref: 'Post.author', many: true }) },
      access: { operation: OPEN },
    }),
    Post: list({
      fields: { title: text(), author: relationship({ ref: 'Author.posts' }) },
      access: { operation: OPEN },
    }),
  },
}

let harness: TestContext
let context: AccessContext
let authorId = ''

beforeAll(async () => {
  harness = await createTestContext(config, { userId: 'admin' })
  context = harness.context as unknown as AccessContext
  const db = harness.context.db
  authorId = String((await db.Author.create({ data: { name: 'Priya' } }))?.id)
  for (let n = 1; n <= 12; n += 1) {
    await db.Post.create({
      data: { title: `Post ${String(n).padStart(2, '0')}`, author: { connect: { id: authorId } } },
    })
  }
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

function findTable(node: React.ReactNode): RelationshipTableProps | undefined {
  for (const child of React.Children.toArray(node)) {
    if (React.isValidElement<RelationshipTableProps>(child) && child.type === RelationshipTable) {
      return child.props
    }
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) continue
    const found = findTable(child.props.children)
    if (found) return found
  }
  return undefined
}

async function postsTable(searchParams: Record<string, string>) {
  const tree = await resolveServer(
    await ItemForm({
      context,
      config,
      listKey: 'Author',
      mode: 'edit',
      itemId: authorId,
      basePath: '/admin',
      serverAction: harness.context.serverAction,
      searchParams,
    }),
  )
  const table = findTable(tree)
  if (!table) throw new Error('No Posts table rendered')
  return table
}

describe('an item page pages its related rows in place', () => {
  it(
    'shows the first ten and links the next page',
    async () => {
      const table = await postsTable({})

      expect(table.rows.map((row) => row.title)).toEqual(
        Array.from({ length: 10 }, (_, i) => `Post ${String(i + 1).padStart(2, '0')}`),
      )
      expect(table.total).toBe(12)
      expect(table.pagination).toEqual({
        offset: 0,
        previousHref: undefined,
        nextHref: `/admin/author/${authorId}?postsPage=2`,
      })
    },
    BOOT,
  )

  it(
    'shows the rest on the page the URL asks for',
    async () => {
      const table = await postsTable({ postsPage: '2' })

      expect(table.rows.map((row) => row.title)).toEqual(['Post 11', 'Post 12'])
      expect(table.pagination).toEqual({
        offset: 10,
        previousHref: `/admin/author/${authorId}`,
        nextHref: undefined,
      })
    },
    BOOT,
  )

  it(
    'points a page past the end at the last page',
    async () => {
      const table = await postsTable({ postsPage: '9' })

      expect(table.rows).toEqual([])
      expect(table.pagination?.lastPageHref).toBe(`/admin/author/${authorId}?postsPage=2`)
    },
    BOOT,
  )
})
