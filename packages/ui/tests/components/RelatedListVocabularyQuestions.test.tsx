// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { engineContextOf, type OpenSaasConfig, type Session } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import { ListView } from '../../src/components/ListView.js'
import { ListViewClient, type ListViewClientProps } from '../../src/components/ListViewClient.js'
import { RelationshipTable, resolveLinkEdge } from '../../src/components/RelationshipTable.js'
import type { RelationshipTableClientProps } from '../../src/components/RelationshipTableClient.js'
import { prepareItemForm } from '../../src/lib/prepareItemForm.js'
import { operationAvailable } from '../../src/lib/operationAvailable.js'

vi.mock('next/navigation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation.js')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/hub',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const BOOT = 120_000

let asked: string[] = []

function counting(name: string): () => boolean {
  return () => {
    asked.push(name)
    return true
  }
}

function countedText(name: string) {
  return text({
    access: {
      read: counting(`${name}.read`),
      create: counting(`${name}.create`),
      update: counting(`${name}.update`),
    },
  })
}

function countedOperations(listKey: string) {
  return {
    query: counting(`${listKey}.query`),
    create: counting(`${listKey}.create`),
    update: counting(`${listKey}.update`),
    delete: counting(`${listKey}.delete`),
  }
}

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Watched: {
      fields: {
        name: countedText('Watched.name'),
        other: countedText('Watched.other'),
        third: countedText('Watched.third'),
        hubs: relationship({ ref: 'Hub.watched', many: true }),
        owner: relationship({
          ref: 'Owner.items',
          access: {
            read: counting('Watched.owner.read'),
            create: counting('Watched.owner.create'),
            update: counting('Watched.owner.update'),
          },
        }),
      },
      access: { operation: countedOperations('Watched') },
    },
    Owner: {
      fields: { name: text(), items: relationship({ ref: 'Watched.owner', many: true }) },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
    },
    Hub: {
      fields: {
        name: text(),
        watched: relationship({ ref: 'Watched.hubs' }),
      },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
    },
  },
}

const admin: Session = { userId: 'user-1', role: 'admin' }
const MISSING_ID = '0190a000-0000-7000-8000-000000000000'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(() => {
  asked = []
})

function askedOf(listKey: string): string[] {
  return [...new Set(asked.filter((name) => name.startsWith(`${listKey}.`)))].sort()
}

function listViewProps(tree: React.ReactElement): ListViewClientProps {
  const outer = tree as React.ReactElement<{ children: React.ReactNode }>
  const client = React.Children.toArray(outer.props.children).find(
    (child): child is React.ReactElement<ListViewClientProps> =>
      React.isValidElement(child) && child.type === ListViewClient,
  )
  if (!client) throw new Error('ListViewClient not found in ListView output')
  return client.props
}

describe('a consumer asking about a related list asks only the rules its answers need', () => {
  it(
    'the item form’s relationship options ask the related list’s query and label read',
    async () => {
      const context = engineContextOf(database.context(admin))
      await prepareItemForm(context, config, 'Hub', config.lists.Hub, {}, 'create')

      expect(askedOf('Watched')).toEqual(['Watched.name.read', 'Watched.query'])
    },
    BOOT,
  )

  it(
    'the list view’s filter-chip labels ask the related list’s query and label read',
    async () => {
      const props = listViewProps(
        await ListView({
          context: engineContextOf(database.context(admin)),
          config,
          basePath: '/admin',
          listKey: 'Hub',
          search: `watched:#${MISSING_ID}`,
        }),
      )

      expect(props.recordLabels).toEqual({ watched: [{ id: MISSING_ID, label: null }] })
      expect(askedOf('Watched')).toEqual(['Watched.name.read', 'Watched.query'])
    },
    BOOT,
  )

  it(
    'the Relationship table’s column-target labels ask only the target list’s query',
    async () => {
      const element = await RelationshipTable({
        config,
        section: {
          fieldName: 'hubs',
          ref: 'Hub.watched',
          relatedListKey: 'Hub',
          backReferenceField: 'watched',
          columns: ['name', 'watched'],
          take: 10,
          sumColumns: [],
          removeAction: 'disconnect',
          disconnectable: true,
        },
        rows: [],
        total: 0,
        basePath: '/admin',
        context: database.context(admin),
        parentListKey: 'Watched',
        parentId: MISSING_ID,
        serverAction: async () => null,
      })
      if (!React.isValidElement<RelationshipTableClientProps>(element)) {
        throw new Error('RelationshipTable rendered no client table')
      }

      expect(element.props.columns).toEqual(['name', 'watched'])
      expect(askedOf('Watched')).toEqual(['Watched.query'])
    },
    BOOT,
  )

  it(
    'an operation gate asks only that operation’s rule',
    async () => {
      expect(await operationAvailable(database.context(admin), 'Watched', 'create')).toBe(true)

      expect(askedOf('Watched')).toEqual(['Watched.create'])
    },
    BOOT,
  )

  it(
    'the link control asks only the related list’s update and its back-reference’s update',
    async () => {
      const edge = await resolveLinkEdge(
        {
          fieldName: 'items',
          ref: 'Watched.owner',
          relatedListKey: 'Watched',
          backReferenceField: 'owner',
          columns: ['name'],
          take: 10,
          sumColumns: [],
          removeAction: 'disconnect',
          disconnectable: true,
        },
        'Owner',
        database.context(admin),
      )

      expect(edge?.mode).toBe('foreignKey')
      expect(askedOf('Watched')).toEqual(['Watched.owner.update', 'Watched.update'])
    },
    BOOT,
  )
})
