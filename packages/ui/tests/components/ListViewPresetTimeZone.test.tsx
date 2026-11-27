// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text, timestamp } from '@opensaas/stack-core/fields'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import { ListView, type ListViewProps } from '../../src/components/ListView.js'
import { ListViewClient, type ListViewClientProps } from '../../src/components/ListViewClient.js'

vi.mock('next/navigation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation.js')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/post',
  useSearchParams: () => new URLSearchParams(),
}))

let cookieValue: string | undefined
const cookies = vi.fn(async () => {
  if (cookieValue === undefined) throw new Error('`cookies` was called outside a request scope')
  return { get: (name: string) => (name === 'opensaas-tz' ? { value: cookieValue } : undefined) }
})
vi.mock('next/headers.js', () => ({ cookies: () => cookies() }))

const BOOT = 120_000
const OPEN = { query: () => true }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Post: {
      fields: { title: text(), publishedAt: timestamp() },
      access: { operation: OPEN },
      ui: {
        listView: {
          presets: [
            { key: 'aug-4', label: '4 August', search: 'publishedAt:2026-08-04' },
            { key: 'titled', label: 'Titled', search: 'title:early' },
          ],
        },
      },
    },
  },
}

let database: TestDatabase

function clientProps(tree: React.ReactElement): ListViewClientProps {
  const props: unknown = tree.props
  if (typeof props !== 'object' || props === null || !('children' in props)) {
    throw new Error('ListView output has no children')
  }
  const client = React.Children.toArray(props.children as React.ReactNode).find(
    (child): child is React.ReactElement<ListViewClientProps> =>
      React.isValidElement(child) && child.type === ListViewClient,
  )
  if (!client) throw new Error('ListViewClient not found')
  return client.props
}

async function render(props: Partial<ListViewProps>) {
  return clientProps(
    await ListView({
      context: database.context(null),
      config,
      listKey: 'Post',
      basePath: '/admin',
      ...props,
    }),
  )
}

const titles = (props: ListViewClientProps) => props.items.map((item) => item.title).sort()

beforeAll(async () => {
  database = await createTestDatabase(config)
  const db = database.context(null).sudo().db
  await db.Post.create({ data: { title: 'early', publishedAt: new Date('2026-08-03T15:00:00Z') } })
  await db.Post.create({ data: { title: 'late', publishedAt: new Date('2026-08-04T15:00:00Z') } })
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(() => {
  cookieValue = undefined
  cookies.mockClear()
})

describe("a preset's plain date on a timestamp field", () => {
  it(
    "means the viewer's local day, and hands that query to the table",
    async () => {
      const props = await render({ preset: 'aug-4', timeZone: 'Australia/Sydney' })

      expect(titles(props)).toEqual(['early'])
      expect(props.search).toBe(
        'publishedAt:2026-08-04T00:00:00.000+10:00..2026-08-04T23:59:59.999+10:00',
      )
    },
    BOOT,
  )

  it(
    'reads the time zone the browser recorded',
    async () => {
      cookieValue = 'Australia/Sydney'

      expect(titles(await render({ preset: 'aug-4' }))).toEqual(['early'])
    },
    BOOT,
  )

  it(
    'falls back to the UTC day with no recorded zone',
    async () => {
      const props = await render({ preset: 'aug-4' })

      expect(titles(props)).toEqual(['late'])
      expect(props.search).toBe('publishedAt:2026-08-04')
    },
    BOOT,
  )

  it(
    'ignores a recorded zone that is not a time zone',
    async () => {
      cookieValue = 'Not/AZone'

      expect(titles(await render({ preset: 'aug-4' }))).toEqual(['late'])
    },
    BOOT,
  )
})

describe('reading the recorded zone', () => {
  it(
    'happens only for a preset that has a plain date on a timestamp field',
    async () => {
      cookieValue = 'Australia/Sydney'

      expect(titles(await render({ preset: 'titled' }))).toEqual(['early'])
      await render({})
      await render({ search: 'publishedAt:2026-08-04' })

      expect(cookies).not.toHaveBeenCalled()
    },
    BOOT,
  )

  it(
    'leaves a plain date typed into the URL as the UTC day',
    async () => {
      cookieValue = 'Australia/Sydney'

      expect(titles(await render({ search: 'publishedAt:2026-08-04' }))).toEqual(['late'])
    },
    BOOT,
  )
})
