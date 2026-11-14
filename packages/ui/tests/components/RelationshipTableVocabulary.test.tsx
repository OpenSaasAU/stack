import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { OpenSaasConfig, Session } from '@opensaas/stack-core'
import { engineContextOf } from '@opensaas/stack-core'
import { integer, relationship, text } from '@opensaas/stack-core/fields'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import { RelationshipTable } from '../../src/components/RelationshipTable.js'
import type { RelationshipTableClientProps } from '../../src/components/RelationshipTableClient.js'
import type { RelationshipTableSection } from '../../src/lib/deriveItemView.js'
import { prepareItemForm } from '../../src/lib/prepareItemForm.js'

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const BOOT = 120_000

type RuleArgs = { session: Session | null; item?: Record<string, unknown> }

const isAdmin = ({ session }: RuleArgs): boolean => session?.role === 'admin'

const ownsTask = ({ session, item }: RuleArgs): boolean => item?.assignee === session?.userId

function adminOrNothing(args: RuleArgs): boolean
function adminOrNothing({ session }: RuleArgs): boolean | null | undefined {
  if (session?.role === 'admin') return true
  return session?.role === 'returns-null' ? null : undefined
}

function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Project: {
        fields: {
          name: text(),
          tasks: relationship({ ref: 'Task.project', many: true }),
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
      Task: {
        fields: {
          title: text(),
          assignee: text(),
          secret: text({ access: { read: () => false } }),
          cost: integer({ access: { read: () => false } }),
          status: text({ access: { update: ownsTask } }),
          frozen: text({ access: { update: () => false } }),
          reviewer: relationship({ ref: 'Reviewer' }),
          project: relationship({ ref: 'Project.tasks' }),
        },
        access: {
          operation: {
            query: () => true,
            create: adminOrNothing,
            update: adminOrNothing,
            delete: adminOrNothing,
          },
        },
      },
      Reviewer: {
        fields: { name: text() },
        access: {
          operation: { query: isAdmin, create: isAdmin, update: isAdmin, delete: isAdmin },
        },
      },
    },
  }
}

function section(overrides: Partial<RelationshipTableSection> = {}): RelationshipTableSection {
  return {
    fieldName: 'tasks',
    ref: 'Task.project',
    relatedListKey: 'Task',
    backReferenceField: 'project',
    columns: ['title', 'secret', 'status', 'frozen', 'reviewer'],
    take: 10,
    sumColumns: ['cost'],
    removeAction: 'disconnect',
    disconnectable: true,
    ...overrides,
  }
}

const ROWS = [
  {
    id: 'task-1',
    title: 'Write the plan',
    assignee: 'user-1',
    secret: 'SecretValueNeverSent',
    cost: 4242,
    status: 'open',
    frozen: 'ice',
    reviewer: { id: 'reviewer-1', name: 'ReviewerLabelRita' },
  },
]

let database: TestDatabase
const config = makeConfig()

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

async function tableProps(
  session: Session | null,
  overrides: Partial<RelationshipTableSection> = {},
): Promise<RelationshipTableClientProps> {
  const element = await RelationshipTable({
    config,
    section: section(overrides),
    rows: ROWS,
    total: ROWS.length,
    basePath: '/admin',
    context: database.context(session),
    parentListKey: 'Project',
    parentId: 'project-1',
    serverAction: async () => null,
  })
  if (!React.isValidElement<RelationshipTableClientProps>(element)) {
    throw new Error('RelationshipTable rendered no client table')
  }
  return element.props
}

const admin = { userId: 'user-1', role: 'admin' }

describe('Relationship table reads the related list’s Session vocabulary', () => {
  it(
    'leaves never-readable related columns out of everything that reaches the client',
    async () => {
      const props = await tableProps(admin)

      expect(props.columns).toEqual(['title', 'status', 'frozen', 'reviewer'])
      expect(Object.keys(props.fields)).not.toContain('secret')
      expect(props.sumColumns).toEqual([])
      expect(props.sums).toEqual({})
      expect(props.editableColumns).not.toContain('secret')
      const sent = JSON.stringify(props)
      expect(sent).not.toContain('SecretValueNeverSent')
      expect(sent).not.toContain('4242')
    },
    BOOT,
  )

  it(
    'leaves a column whose update rule optional-chains `item` inline-editable',
    async () => {
      const props = await tableProps(admin)

      expect(props.editableColumns).toContain('status')
      expect(props.editableColumns).toContain('title')
      expect(props.editableColumns).not.toContain('frozen')
      expect(props.editableColumns).not.toContain('reviewer')
    },
    BOOT,
  )

  it(
    'offers remove, create and link where the related list’s operations are allowed',
    async () => {
      const props = await tableProps(admin)

      expect(props.removeMode).toBe('disconnect')
      expect(props.canCreate).toBe(true)
      expect(props.linkEdge?.mode).toBe('foreignKey')
      expect((await tableProps(admin, { removeAction: 'delete' })).removeMode).toBe('delete')
    },
    BOOT,
  )

  it.each([
    ['null', { userId: 'user-1', role: 'returns-null' }],
    ['undefined', { userId: 'user-1', role: 'returns-undefined' }],
  ])(
    'hides remove, disconnect, link, create and inline edit when the operation rule returns %s',
    async (_name, session) => {
      const disconnect = await tableProps(session)
      expect(disconnect.removeMode).toBeNull()
      expect(disconnect.linkEdge).toBeUndefined()
      expect(disconnect.canCreate).toBe(false)
      expect(disconnect.editableColumns).toEqual([])

      const remove = await tableProps(session, { removeAction: 'delete' })
      expect(remove.removeMode).toBeNull()
    },
    BOOT,
  )

  it(
    'resolves a relationship column’s labels only where its own target list may be queried',
    async () => {
      const allowed = await tableProps(admin)
      expect(allowed.rows[0]?.reviewer).toEqual({ id: 'reviewer-1', label: 'ReviewerLabelRita' })

      const denied = await tableProps({ userId: 'user-1', role: 'returns-null' })
      expect(denied.rows[0]?.reviewer).toBeNull()
      expect(JSON.stringify(denied)).not.toContain('ReviewerLabelRita')
    },
    BOOT,
  )
})

describe('item form relationship lookups read the related list’s Session vocabulary', () => {
  beforeAll(async () => {
    await database
      .context(null)
      .sudo()
      .db.Reviewer.create({ data: { name: 'LookupRita' } })
  }, BOOT)

  async function reviewerOptions(session: Session) {
    const { relationshipData } = await prepareItemForm(
      engineContextOf(database.context(session)),
      config,
      'Task',
      config.lists.Task,
      {},
      'create',
    )
    return relationshipData.reviewer
  }

  it(
    'looks up labels when the session may query the related list',
    async () => {
      expect((await reviewerOptions(admin)).map((option) => option.label)).toContain('LookupRita')
    },
    BOOT,
  )

  it(
    'looks up nothing when the related list’s query is denied',
    async () => {
      expect(await reviewerOptions({ userId: 'user-1', role: 'returns-null' })).toEqual([])
    },
    BOOT,
  )
})
