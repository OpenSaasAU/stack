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
import { untypedRule } from '../untyped-rule.js'

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const BOOT = 120_000

type RuleArgs = { session: Session | null; item?: Record<string, unknown> }

const isAdmin = ({ session }: RuleArgs): boolean => session?.role === 'admin'

const ownsTask = ({ session, item }: RuleArgs): boolean => item?.assignee === session?.userId

const adminOrNothing = untypedRule(({ session }: RuleArgs) => {
  if (session?.role === 'admin') return true
  return session?.role === 'returns-null' ? null : undefined
})

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
    'refuses a row-dependent inline edit for a row the session cannot edit, with a reason the cell shows',
    async () => {
      const task = await database
        .context(null)
        .sudo()
        .db.Task.create({ data: { title: 'Not mine', assignee: 'someone-else', status: 'open' } })
      if (task === null) throw new Error('fixture task was not created')
      const id = String(task.id)

      const outcome = await database.context(admin).serverAction({
        listKey: 'Task',
        action: 'updateRelated',
        id,
        field: 'status',
        value: 'done',
      })

      expect(outcome).toMatchObject({ updated: false, error: expect.any(String) })
      const stored = await database
        .context(null)
        .sudo()
        .db.Task.where({ id: { equals: id } })
        .first()
      expect(stored?.status).toBe('open')
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

function makeEdgeConfig(): OpenSaasConfig {
  const open = { query: () => true, create: () => true, update: () => true, delete: () => true }
  return {
    db: { provider: 'postgresql' },
    lists: {
      Board: {
        fields: {
          name: text(),
          cards: relationship({ ref: 'Card.board', many: true }),
          notes: relationship({ ref: 'Note.board', many: true }),
          feedback: relationship({ ref: 'Feedback.board', many: true }),
          labels: relationship({ ref: 'BoardLabel.board', many: true }),
          tags: relationship({ ref: 'BoardTag.board', many: true }),
          stars: relationship({ ref: 'BoardStar.board', many: true }),
        },
        access: { operation: open },
      },
      Card: {
        fields: {
          title: text(),
          board: relationship({ ref: 'Board.cards', access: { update: () => false } }),
        },
        access: { operation: open },
      },
      Note: {
        fields: {
          body: text(),
          board: relationship({ ref: 'Board.notes', access: { create: () => false } }),
        },
        access: { operation: open },
      },
      Feedback: {
        fields: {
          body: text(),
          board: relationship({ ref: 'Board.feedback' }),
        },
        access: { operation: { create: () => true, update: () => true, delete: () => true } },
      },
      Label: {
        fields: {
          name: text(),
          boards: relationship({ ref: 'BoardLabel.label', many: true }),
        },
        access: { operation: open },
      },
      BoardLabel: {
        fields: {
          board: relationship({ ref: 'Board.labels', access: { create: () => false } }),
          label: relationship({ ref: 'Label.boards' }),
        },
        access: { operation: open },
      },
      Tag: {
        fields: {
          name: text(),
          boards: relationship({ ref: 'BoardTag.tag', many: true }),
        },
        access: { operation: open },
      },
      BoardTag: {
        fields: {
          board: relationship({ ref: 'Board.tags' }),
          tag: relationship({ ref: 'Tag.boards', access: { create: () => false } }),
        },
        access: { operation: open },
      },
      Star: {
        fields: {
          name: text(),
          boards: relationship({ ref: 'BoardStar.star', many: true }),
        },
        access: { operation: open },
      },
      BoardStar: {
        fields: {
          board: relationship({ ref: 'Board.stars' }),
          star: relationship({ ref: 'Star.boards' }),
        },
        access: { operation: open },
      },
    },
  }
}

function edgeSection(
  fieldName: string,
  ref: string,
  overrides: Partial<RelationshipTableSection> = {},
): RelationshipTableSection {
  const [relatedListKey, backReferenceField] = ref.split('.')
  return {
    fieldName,
    ref,
    relatedListKey,
    backReferenceField,
    columns: ['body'],
    take: 10,
    sumColumns: [],
    removeAction: 'disconnect',
    disconnectable: true,
    ...overrides,
  }
}

describe('Relationship table reads the back-reference field’s own answers', () => {
  const edgeConfig = makeEdgeConfig()
  let edgeDatabase: TestDatabase

  beforeAll(async () => {
    edgeDatabase = await createTestDatabase(edgeConfig)
  }, BOOT)

  afterAll(async () => {
    await edgeDatabase?.close()
  })

  async function edgeProps(
    tableSection: RelationshipTableSection,
    propConfig: OpenSaasConfig = edgeConfig,
  ): Promise<RelationshipTableClientProps> {
    const element = await RelationshipTable({
      config: propConfig,
      section: tableSection,
      rows: [{ id: 'row-1', title: 'A card', body: 'NeverShownBody' }],
      total: 1,
      basePath: '/admin',
      context: edgeDatabase.context(admin),
      parentListKey: 'Board',
      parentId: 'board-1',
      serverAction: async () => null,
    })
    if (!React.isValidElement<RelationshipTableClientProps>(element)) {
      throw new Error('RelationshipTable rendered no client table')
    }
    return element.props
  }

  it(
    'hides disconnect and link when the back-reference field’s update is denied',
    async () => {
      const props = await edgeProps(edgeSection('cards', 'Card.board', { columns: ['title'] }))

      expect(props.removeMode).toBeNull()
      expect(props.linkEdge).toBeUndefined()
      expect(props.canCreate).toBe(true)
    },
    BOOT,
  )

  it(
    'hides “+ Add” when the back-reference field’s create is denied',
    async () => {
      const props = await edgeProps(edgeSection('notes', 'Note.board'))

      expect(props.canCreate).toBe(false)
      expect(props.removeMode).toBe('disconnect')
      expect(props.linkEdge?.mode).toBe('foreignKey')
    },
    BOOT,
  )

  it(
    'hides the junction link when a junction foreign key’s create is denied',
    async () => {
      const props = await edgeProps(edgeSection('labels', 'BoardLabel.board', { columns: [] }))

      expect(props.linkEdge).toBeUndefined()
    },
    BOOT,
  )

  it(
    'hides the junction link when the junction’s target foreign key’s create is denied',
    async () => {
      const props = await edgeProps(edgeSection('tags', 'BoardTag.board', { columns: [] }))

      expect(props.linkEdge).toBeUndefined()
    },
    BOOT,
  )

  it(
    'offers the junction link when both junction foreign keys may be created',
    async () => {
      const props = await edgeProps(edgeSection('stars', 'BoardStar.board', { columns: [] }))

      expect(props.linkEdge).toMatchObject({
        mode: 'junction',
        junctionListKey: 'BoardStar',
        targetField: 'star',
      })
    },
    BOOT,
  )

  it(
    'renders a query-denied related list unavailable, with no columns and no write controls',
    async () => {
      const props = await edgeProps(edgeSection('feedback', 'Feedback.board'))

      expect(props.unavailable).toBe(true)
      expect(props.columns).toEqual([])
      expect(props.rows).toEqual([])
      expect(props.removeMode).toBeNull()
      expect(props.canCreate).toBe(false)
      expect(props.linkEdge).toBeUndefined()
      expect(props.editableColumns).toEqual([])
      expect(JSON.stringify(props)).not.toContain('NeverShownBody')
    },
    BOOT,
  )

  it(
    'renders a related list the context cannot resolve unavailable instead of throwing',
    async () => {
      const propConfig: OpenSaasConfig = {
        ...edgeConfig,
        lists: {
          ...edgeConfig.lists,
          Board: {
            ...edgeConfig.lists.Board,
            fields: {
              ...edgeConfig.lists.Board.fields,
              ghosts: relationship({ ref: 'Ghost.board', many: true }),
            },
          },
          Ghost: {
            fields: { body: text(), board: relationship({ ref: 'Board.ghosts' }) },
            access: { operation: { query: () => true, update: () => true, create: () => true } },
          },
        },
      }

      const props = await edgeProps(edgeSection('ghosts', 'Ghost.board'), propConfig)

      expect(props.unavailable).toBe(true)
      expect(props.columns).toEqual([])
      expect(props.removeMode).toBeNull()
      expect(props.canCreate).toBe(false)
      expect(props.linkEdge).toBeUndefined()
    },
    BOOT,
  )
})
