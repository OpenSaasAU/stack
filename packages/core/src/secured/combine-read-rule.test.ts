import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { checkbox, relationship, text, virtual } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import type { Refinement, SecuredRefinement } from './include.js'

const BOOT = 120_000

type RuleView = readonly string[] | 'absent'

const views = new Map<string, RuleView>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function noPrivateRows(value: unknown): boolean {
  return Array.isArray(value) && value.every((row) => isRecord(row) && row.public !== false)
}

function recordView(id: unknown, value: unknown): void {
  views.set(
    String(id),
    Array.isArray(value) ? value.map((row) => String(row.body)).sort() : 'absent',
  )
}

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Agent: {
      fields: { name: text() },
      access: { operation: { query: () => true, create: () => true } },
    },
    Project: {
      fields: {
        name: text(),
        tickets: relationship({ ref: 'Ticket.project', many: true }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
    Ticket: {
      fields: {
        name: text(),
        summary: text({ access: { read: ({ item }) => noPrivateRows(item.notes) } }),
        project: relationship({ ref: 'Project.tickets' }),
        assignee: relationship({
          ref: 'Agent',
          access: { read: ({ item }) => noPrivateRows(item.notes) },
        }),
        notes: relationship({
          ref: 'Note.ticket',
          many: true,
          access: {
            read: ({ item }) => {
              recordView(item.id, item.notes)
              return noPrivateRows(item.notes)
            },
          },
        }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
    Note: {
      fields: {
        body: text(),
        public: checkbox(),
        ticket: relationship({ ref: 'Ticket.notes' }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
    Case: {
      fields: {
        name: text(),
        reviewer: relationship({
          ref: 'Agent',
          access: { read: ({ item }) => noPrivateRows(item.entries) },
        }),
        entries: relationship({
          ref: 'Entry.case',
          many: true,
          access: {
            read: ({ item }) => {
              recordView(item.id, item.entries)
              return noPrivateRows(item.entries)
            },
          },
        }),
        entryCount: virtual({
          type: 'number',
          needs: ['entries'],
          hooks: {
            resolveOutput: ({ item }) => (Array.isArray(item.entries) ? item.entries.length : -1),
          },
        }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
    Entry: {
      fields: {
        body: text(),
        public: checkbox(),
        case: relationship({ ref: 'Case.entries' }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
    Shelf: {
      fields: {
        name: text(),
        label: text({ access: { read: ({ item }) => noPrivateRows(item.from_Book_shelf) } }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
    Book: {
      fields: {
        body: text(),
        public: checkbox(),
        shelf: relationship({ ref: 'Shelf' }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
  },
}

const publicOnly = { public: { equals: true } }

type Narrowing = (rows: SecuredRefinement) => SecuredRefinement

const narrowings: readonly (readonly [string, Narrowing])[] = [
  ['where', (rows) => rows.where(publicOnly)],
  ['limit', (rows) => rows.orderBy({ body: 'asc' }).limit(1)],
  ['limit of 0', (rows) => rows.limit(0)],
  ['offset', (rows) => rows.orderBy({ body: 'desc' }).offset(1)],
  ['offset alone', (rows) => rows.offset(1)],
  ['orderBy', (rows) => rows.orderBy({ body: 'asc' })],
  ['select', (rows) => rows.select('body')],
]

const noteNarrowings: readonly (readonly [string, Narrowing])[] = [
  ...narrowings,
  ['nested include', (rows) => rows.include('ticket')],
]

function combined(narrow: Narrowing): Refinement {
  return (rows) => rows.combine({ rows: narrow(rows), total: rows.count() })
}

describe('a read rule on a relation read through combine()', () => {
  let db: TestDatabase

  async function ticketsThrough(refine: Refinement) {
    views.clear()
    const rows = await db
      .context({})
      .db.Ticket.orderBy({ name: 'asc' })
      .include('notes', refine)
      .all()
    return { rows, views: new Map(views) }
  }

  async function casesThrough(refine: Refinement, select?: readonly string[]) {
    views.clear()
    const base = db.context({}).db.Case.orderBy({ name: 'asc' })
    const read = select === undefined ? base : base.select(...select)
    const rows = await read.include('entries', refine).all()
    return { rows, views: new Map(views) }
  }

  beforeAll(async () => {
    db = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await db?.close()
  })

  beforeEach(async () => {
    await db.truncate()
    const admin = db.context({}).sudo()
    const project = await admin.db.Project.create({ data: { name: 'p' } })
    const agent = await admin.db.Agent.create({ data: { name: 'a' } })
    for (const [name, secondIsPublic] of [
      ['all-public', true],
      ['mixed', false],
    ] as const) {
      const ticket = await admin.db.Ticket.create({
        data: {
          name,
          summary: 'SUMMARY',
          project: { connect: { id: project!.id } },
          assignee: { connect: { id: agent!.id } },
        },
      })
      const kase = await admin.db.Case.create({
        data: { name, reviewer: { connect: { id: agent!.id } } },
      })
      const shelf = await admin.db.Shelf.create({ data: { name, label: 'LABEL' } })
      for (const [body, isPublic] of [
        [`${name}-1`, true],
        [`${name}-2`, secondIsPublic],
      ] as const) {
        await admin.db.Note.create({
          data: { body, public: isPublic, ticket: { connect: { id: ticket!.id } } },
        })
        await admin.db.Entry.create({
          data: { body, public: isPublic, case: { connect: { id: kase!.id } } },
        })
        await admin.db.Book.create({
          data: { body, public: isPublic, shelf: { connect: { id: shelf!.id } } },
        })
      }
    }
  })

  describe('with no unshaped declared rows to stand in', () => {
    test.each(noteNarrowings)(
      'a %s on the rows branch strips exactly what the plain include strips',
      async (_, narrow) => {
        const plain = await ticketsThrough(narrow)
        const reduced = await ticketsThrough(combined(narrow))

        expect(plain.rows.map((row) => 'notes' in row)).toEqual([false, false])
        expect(reduced.rows).toEqual(plain.rows)
        expect(reduced.views).toEqual(plain.views)
        expect([...reduced.views.values()]).toEqual(['absent', 'absent'])
      },
      BOOT,
    )

    test(
      'a where beside the combine counts as narrowing too',
      async () => {
        const plain = await ticketsThrough((rows) => rows.where(publicOnly))
        const reduced = await ticketsThrough((rows) =>
          rows.where(publicOnly).combine({ rows, total: rows.count() }),
        )

        expect(reduced.rows).toEqual(plain.rows)
        expect(reduced.views).toEqual(plain.views)
      },
      BOOT,
    )

    test(
      'an unshaped rows branch shows the rule the rows a plain include does',
      async () => {
        const plain = await ticketsThrough((rows) => rows)
        const reduced = await ticketsThrough((rows) => rows.combine({ rows, total: rows.count() }))

        expect(reduced.views).toEqual(plain.views)
        expect(plain.rows.map((row) => 'notes' in row)).toEqual([true, false])
        expect(reduced.rows[0]).toMatchObject({ notes: { total: 2 } })
        expect(reduced.rows[1]).toEqual(plain.rows[1])
      },
      BOOT,
    )

    test(
      'a rule on a sibling field is held to the same view',
      async () => {
        const unshaped = await ticketsThrough((rows) => rows.combine({ rows, total: rows.count() }))
        const narrowed = await ticketsThrough(combined((rows) => rows.where(publicOnly)))

        expect(unshaped.rows.map((row) => 'summary' in row)).toEqual([true, false])
        expect(narrowed.rows.map((row) => 'summary' in row)).toEqual([false, false])
      },
      BOOT,
    )

    test(
      'first() takes the same decision',
      async () => {
        const row = await db
          .context({})
          .db.Ticket.where({ name: { equals: 'mixed' } })
          .include(
            'notes',
            combined((rows) => rows.where(publicOnly)),
          )
          .first()

        expect(row).not.toBeNull()
        expect(row).not.toHaveProperty('notes')
      },
      BOOT,
    )

    test(
      'a bare count keeps the stand-in its Known limits describe',
      async () => {
        const { rows, views: seen } = await ticketsThrough((notes) =>
          notes.where(publicOnly).count(),
        )

        expect(rows.map((row) => Reflect.get(row, 'notes'))).toEqual([2, 1])
        expect([...seen.values()]).toEqual([[], []])
      },
      BOOT,
    )
  })

  describe('below another include', () => {
    function ticketsOf(project: unknown, branch?: string): Record<string, unknown>[] {
      const value = isRecord(project) ? project.tickets : undefined
      const rows = branch === undefined ? value : isRecord(value) ? value[branch] : undefined
      return Array.isArray(rows) ? rows.filter(isRecord) : []
    }

    test.each(noteNarrowings)(
      'a %s under a plain include strips as the plain include does',
      async (_, narrow) => {
        const context = db.context({})
        const [plain] = await context.db.Project.include('tickets', (tickets) =>
          tickets.orderBy({ name: 'asc' }).include('notes', narrow),
        ).all()
        const [reduced] = await context.db.Project.include('tickets', (tickets) =>
          tickets.orderBy({ name: 'asc' }).include('notes', combined(narrow)),
        ).all()

        expect(ticketsOf(plain).map((row) => 'notes' in row)).toEqual([false, false])
        expect(ticketsOf(reduced)).toEqual(ticketsOf(plain))
      },
      BOOT,
    )

    test.each(noteNarrowings)(
      'a %s under a combine rows branch strips as the plain include does',
      async (_, narrow) => {
        const context = db.context({})
        const [plain] = await context.db.Project.include('tickets', (tickets) =>
          tickets.orderBy({ name: 'asc' }).include('notes', narrow),
        ).all()
        const [reduced] = await context.db.Project.include('tickets', (tickets) =>
          tickets.combine({
            rows: tickets.orderBy({ name: 'asc' }).include('notes', combined(narrow)),
            total: tickets.count(),
          }),
        ).all()

        expect(ticketsOf(reduced, 'rows')).toEqual(ticketsOf(plain))
      },
      BOOT,
    )
  })

  describe('with unshaped declared rows to stand in', () => {
    test.each(narrowings)(
      'a %s on the rows branch shows the rule every row, as the plain include does',
      async (_, narrow) => {
        const plain = await casesThrough(narrow)
        const reduced = await casesThrough(combined(narrow))

        expect(reduced.views).toEqual(plain.views)
        expect([...reduced.views.values()].map((view) => view.length)).toEqual([2, 2])
        expect(plain.rows.map((row) => 'entries' in row)).toEqual([true, false])
        expect(reduced.rows.map((row) => 'entries' in row)).toEqual([true, false])
      },
      BOOT,
    )

    test(
      'the caller keeps the narrowed rows where the rule grants',
      async () => {
        const { rows } = await casesThrough(combined((entries) => entries.where(publicOnly)))

        expect(rows[0]).toMatchObject({ entryCount: 2, entries: { total: 2 } })
        expect(rows[1]).toMatchObject({ entryCount: 2 })
        expect(rows[1]).not.toHaveProperty('entries')
      },
      BOOT,
    )

    test(
      'a projection that drops the declaring field leaves no rows to stand in',
      async () => {
        const narrow: Narrowing = (entries) => entries.where(publicOnly)
        const plain = await casesThrough(narrow, ['name'])
        const reduced = await casesThrough(combined(narrow), ['name'])

        expect(plain.rows.map((row) => 'entries' in row)).toEqual([false, false])
        expect(reduced.rows).toEqual(plain.rows)
        expect([...reduced.views.values()]).toEqual(['absent', 'absent'])
      },
      BOOT,
    )
  })

  describe('through a synthetic back-relation', () => {
    test.each(narrowings)(
      'a %s on the rows branch hides what the plain include hides',
      async (_, narrow) => {
        const context = db.context({})
        const plain = await context.db.Shelf.orderBy({ name: 'asc' })
          .include('from_Book_shelf', narrow)
          .all()
        const reduced = await context.db.Shelf.orderBy({ name: 'asc' })
          .include('from_Book_shelf', combined(narrow))
          .all()

        expect(plain.map((row) => 'label' in row)).toEqual([false, false])
        expect(reduced.map((row) => 'label' in row)).toEqual([false, false])
      },
      BOOT,
    )

    test(
      'an unshaped rows branch is decided against its rows',
      async () => {
        const reduced = await db
          .context({})
          .db.Shelf.orderBy({ name: 'asc' })
          .include('from_Book_shelf', (books) =>
            books.combine({ rows: books, total: books.count() }),
          )
          .all()

        expect(reduced.map((row) => 'label' in row)).toEqual([true, false])
      },
      BOOT,
    )
  })

  describe('the rule on an un-included foreign key', () => {
    function assigned(rows: readonly Record<string, unknown>[]): boolean[] {
      return rows.map((row) => row.assigneeId !== null)
    }

    test.each(noteNarrowings)(
      'a %s on the sibling relation grants neither path',
      async (_, narrow) => {
        const plain = await ticketsThrough(narrow)
        const reduced = await ticketsThrough(combined(narrow))

        expect(assigned(plain.rows)).toEqual([false, false])
        expect(assigned(reduced.rows)).toEqual([false, false])
      },
      BOOT,
    )

    test.each<readonly [string, Refinement]>([
      ['count()', (rows) => rows.count()],
      ['where().count()', (rows) => rows.where(publicOnly).count()],
      ['a combine of counts', (rows) => rows.combine({ total: rows.count() })],
      [
        'a combine of narrowed counts',
        (rows) => rows.combine({ open: rows.where(publicOnly).count() }),
      ],
    ])(
      'a sibling read as %s opens no foreign key',
      async (_, reduce) => {
        const { rows } = await ticketsThrough(reduce)

        expect(assigned(rows)).toEqual([false, false])
      },
      BOOT,
    )

    test(
      'a sibling read as a count is decided on its declared rows where they exist',
      async () => {
        const { rows } = await casesThrough((entries) => entries.count())

        expect(rows.map((row) => row.reviewerId !== null)).toEqual([true, false])
      },
      BOOT,
    )

    test(
      'an unshaped rows branch is read as rows, not as its envelope',
      async () => {
        const plain = await ticketsThrough((rows) => rows)
        const reduced = await ticketsThrough((rows) => rows.combine({ rows, total: rows.count() }))

        expect(assigned(plain.rows)).toEqual([true, false])
        expect(assigned(reduced.rows)).toEqual([true, false])
      },
      BOOT,
    )
  })
})
