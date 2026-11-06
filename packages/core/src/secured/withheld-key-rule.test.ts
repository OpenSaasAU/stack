import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { checkbox, relationship, text, virtual } from '../fields/index.js'
import { InvalidFieldAccessResultError } from '../access/errors.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import type { Refinement } from './include.js'

const BOOT = 120_000

const open = { query: () => true, create: () => true, update: () => true, delete: () => true }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function noPrivateRows(value: unknown): boolean {
  return Array.isArray(value) && value.every((row) => isRecord(row) && row.public !== false)
}

function absenceAllows(value: unknown): boolean {
  return !(value as readonly { public: boolean }[] | undefined)?.some((row) => !row.public)
}

let mutatorRan = 0

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Agent: {
      fields: {
        name: text(),
        tickets: relationship({ ref: 'Ticket.assignee', many: true }),
      },
      access: { operation: open },
    },
    Org: {
      fields: { name: text(), projects: relationship({ ref: 'Project.org', many: true }) },
      access: { operation: open },
    },
    Project: {
      fields: {
        name: text(),
        org: relationship({ ref: 'Org.projects' }),
        tickets: relationship({ ref: 'Ticket.project', many: true }),
      },
      access: { operation: open },
    },
    Ticket: {
      fields: {
        name: text(),
        ownerId: text(),
        summary: text({ access: { read: ({ item }) => noPrivateRows(item.notes) } }),
        absent: text({ access: { read: ({ item }) => absenceAllows(item.notes) } }),
        owned: text({
          access: { read: ({ item, session }) => item.ownerId === session?.userId },
        }),
        peerCount: text({
          access: {
            read: ({ item }) =>
              isRecord(item.project) &&
              noPrivateRows(item.project.tickets as readonly unknown[] | undefined),
          },
        }),
        project: relationship({ ref: 'Project.tickets' }),
        assignee: relationship({
          ref: 'Agent.tickets',
          access: { read: ({ item }) => noPrivateRows(item.notes) },
        }),
        reviewer: relationship({
          ref: 'Agent',
          access: { read: ({ item }) => absenceAllows(item.notes) },
        }),
        attachments: relationship({
          ref: 'Attachment.ticket',
          many: true,
          access: { read: ({ item }) => noPrivateRows(item.notes) },
        }),
        notes: relationship({
          ref: 'Note.ticket',
          many: true,
          access: { read: ({ item }) => noPrivateRows(item.notes) },
        }),
        memos: relationship({
          ref: 'Memo.ticket',
          many: true,
          access: { read: ({ item }) => absenceAllows(item.memos) },
        }),
        logs: relationship({
          ref: 'Log.ticket',
          many: true,
          access: { read: ({ item }) => (item.logs as readonly unknown[]).length === 0 },
        }),
        watches: relationship({
          ref: 'Watch.ticket',
          many: true,
          access: { read: ({ item, session }) => item.ownerId === session?.userId },
        }),
      },
      access: { operation: open },
    },
    Note: {
      fields: {
        body: text(),
        public: checkbox(),
        ticket: relationship({ ref: 'Ticket.notes' }),
      },
      access: { operation: open },
    },
    Memo: {
      fields: {
        body: text(),
        public: checkbox(),
        ticket: relationship({ ref: 'Ticket.memos' }),
      },
      access: { operation: open },
    },
    Attachment: {
      fields: { body: text(), ticket: relationship({ ref: 'Ticket.attachments' }) },
      access: { operation: open },
    },
    Log: {
      fields: { body: text(), ticket: relationship({ ref: 'Ticket.logs' }) },
      access: { operation: open },
    },
    Watch: {
      fields: { body: text(), ticket: relationship({ ref: 'Ticket.watches' }) },
      access: { operation: open },
    },
    Case: {
      fields: {
        name: text(),
        summary: text({ access: { read: ({ item }) => noPrivateRows(item.entries) } }),
        reviewer: relationship({
          ref: 'Agent',
          access: { read: ({ item }) => noPrivateRows(item.entries) },
        }),
        entries: relationship({
          ref: 'Entry.case',
          many: true,
          access: { read: ({ item }) => noPrivateRows(item.entries) },
        }),
        entryCount: virtual({
          type: 'number',
          needs: ['entries'],
          hooks: {
            resolveOutput: ({ item }) => (Array.isArray(item.entries) ? item.entries.length : -1),
          },
        }),
      },
      access: { operation: open },
    },
    Entry: {
      fields: {
        body: text(),
        public: checkbox(),
        case: relationship({ ref: 'Case.entries' }),
      },
      access: { operation: open },
    },
    Shelf: {
      fields: {
        name: text(),
        label: text({ access: { read: ({ item }) => absenceAllows(item.from_Book_shelf) } }),
      },
      access: { operation: open },
    },
    Book: {
      fields: {
        body: text(),
        public: checkbox(),
        shelf: relationship({
          ref: 'Shelf',
          access: { read: ({ item }) => isRecord(item) && item.public !== false },
        }),
      },
      access: { operation: open },
    },
    Box: { fields: { name: text() }, access: { operation: open } },
    Tag: {
      fields: { label: text(), part: relationship({ ref: 'Part.tags' }) },
      access: { operation: open },
    },
    Part: {
      fields: {
        name: text(),
        tags: relationship({ ref: 'Tag.part', many: true }),
        box: relationship({
          ref: 'Box',
          access: { read: ({ item }) => absenceAllows(item.tags) },
        }),
      },
      access: { operation: open },
    },
    Guarded: {
      fields: {
        name: text(),
        first: text({
          access: {
            read: ({ item }) => {
              mutatorRan += 1
              item.name = 'REWRITTEN'
              return true
            },
          },
        }),
        second: text({ access: { read: ({ item }) => item.name === 'original' } }),
        items: relationship({
          ref: 'GuardedItem.parent',
          many: true,
          access: {
            read: ({ item }) => {
              ;(item.items as unknown[]).pop()
              return true
            },
          },
        }),
        sibling: text({
          access: { read: ({ item }) => (item.items as unknown[] | undefined)?.length === 1 },
        }),
      },
      access: { operation: open },
    },
    GuardedItem: {
      fields: { body: text(), parent: relationship({ ref: 'Guarded.items' }) },
      access: { operation: open },
    },
    Broken: {
      fields: {
        name: text(),
        children: relationship({ ref: 'BrokenChild.parent', many: true }),
        afterWithheld: text({
          access: {
            read: ({ item }) => {
              if (item.children === undefined) throw new Error('a failure after the reach')
              return true
            },
          },
        }),
        ownBug: text({
          access: {
            read: ({ item }) => {
              if (item.name === 'b') throw new Error('a bug of the rule’s own')
              return true
            },
          },
        }),
        filterResult: text({
          access: {
            read: (({ item }: { item: Record<string, unknown> }) =>
              item.children === undefined ? { id: { equals: 'x' } } : true) as never,
          },
        }),
      },
      access: { operation: open },
    },
    BrokenChild: {
      fields: { body: text(), parent: relationship({ ref: 'Broken.children' }) },
      access: { operation: open },
    },
  },
}

const publicOnly = { public: { equals: true } }

const rowless: readonly (readonly [string, Refinement])[] = [
  ['count()', (rows) => rows.count()],
  ['where().count()', (rows) => rows.where(publicOnly).count()],
  ['combine of counts', (rows) => rows.combine({ all: rows.count() })],
  [
    'combine of narrowed counts',
    (rows) =>
      rows.combine({
        priv: rows.where({ public: { equals: false } }).count(),
        secret: rows.where({ body: { contains: 'SECRET' } }).count(),
      }),
  ],
]

const shaped: readonly (readonly [string, Refinement])[] = [
  ['limit', (rows) => rows.limit(100)],
  ['select', (rows) => rows.select('body')],
  ['where', (rows) => rows.where(publicOnly)],
  ['offset', (rows) => rows.offset(0)],
  [
    'a combine with a limited rows branch',
    (rows) => rows.combine({ rows: rows.limit(100), total: rows.count() }),
  ],
  [
    'a combine with a selected rows branch',
    (rows) => rows.combine({ rows: rows.select('body'), total: rows.count() }),
  ],
]

type Rows = readonly Record<string, unknown>[]

describe('a read rule that reaches for a key withheld from it', () => {
  let db: TestDatabase

  beforeAll(async () => {
    db = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await db?.close()
  })

  const ticketRead = () => db.context({ userId: 'owner' }).db.Ticket.orderBy({ name: 'asc' })

  beforeEach(async () => {
    await db.truncate()
    mutatorRan = 0
    const admin = db.context({}).sudo()
    const org = await admin.db.Org.create({ data: { name: 'org' } })
    const project = await admin.db.Project.create({
      data: { name: 'project', org: { connect: { id: org!.id } } },
    })
    const agent = await admin.db.Agent.create({ data: { name: 'agent' } })
    for (const [name, secondIsPublic] of [
      ['all-public', true],
      ['mixed', false],
    ] as const) {
      const ticket = await admin.db.Ticket.create({
        data: {
          name,
          ownerId: 'owner',
          summary: 'SUMMARY',
          absent: 'ABSENT',
          owned: 'OWNED',
          peerCount: 'PEERS',
          project: { connect: { id: project!.id } },
          assignee: { connect: { id: agent!.id } },
          reviewer: { connect: { id: agent!.id } },
        },
      })
      const connect = { ticket: { connect: { id: ticket!.id } } }
      await admin.db.Attachment.create({ data: { body: `${name}-file`, ...connect } })
      await admin.db.Log.create({ data: { body: `${name}-log`, ...connect } })
      await admin.db.Watch.create({ data: { body: `${name}-watch`, ...connect } })
      const kase = await admin.db.Case.create({
        data: { name, summary: 'SUMMARY', reviewer: { connect: { id: agent!.id } } },
      })
      const shelf = await admin.db.Shelf.create({ data: { name, label: 'LABEL' } })
      for (const [suffix, isPublic] of [
        ['public', true],
        [secondIsPublic ? 'also-public' : 'SECRET', secondIsPublic],
      ] as const) {
        const row = { body: `${name}-${suffix}`, public: isPublic }
        await admin.db.Note.create({ data: { ...row, ...connect } })
        await admin.db.Memo.create({ data: { ...row, ...connect } })
        await admin.db.Entry.create({ data: { ...row, case: { connect: { id: kase!.id } } } })
        await admin.db.Book.create({ data: { ...row, shelf: { connect: { id: shelf!.id } } } })
      }
    }
  })

  describe('a rowless reduction on a relation the plain read strips', () => {
    test.each(rowless)(
      '%s reveals nothing on the row the rule rejects',
      async (_, refine) => {
        const plain = await ticketRead().include('notes').all()
        const reduced = await ticketRead().include('notes', refine).all()

        expect(plain.map((row) => 'notes' in row)).toEqual([true, false])
        expect(reduced.map((row) => 'notes' in row)).toEqual([false, false])
      },
      BOOT,
    )

    test(
      'a contains count cannot test a hidden row one predicate at a time',
      async () => {
        const probe = (needle: string) =>
          ticketRead()
            .include('notes', (rows) => rows.where({ body: { contains: needle } }).count())
            .all()

        expect(await probe('SECRET')).toEqual(await probe('NOT-THERE'))
      },
      BOOT,
    )

    test.each(rowless)(
      '%s reveals nothing at depth three',
      async (_, refine) => {
        const rows = await db
          .context({ userId: 'owner' })
          .db.Org.include('projects', (projects) =>
            projects.include('tickets', (tickets) => tickets.include('notes', refine)),
          )
          .all()

        const projects = rows[0].projects as Rows
        const tickets = projects[0].tickets as Rows
        expect(tickets).toHaveLength(2)
        expect(tickets.map((row) => 'notes' in row)).toEqual([false, false])
      },
      BOOT,
    )

    test(
      'a count on a relation whose rule never reads it still answers',
      async () => {
        const rows = await ticketRead()
          .include('watches', (watches) => watches.count())
          .all()
        const stranger = await db
          .context({ userId: 'stranger' })
          .db.Ticket.orderBy({ name: 'asc' })
          .include('watches', (watches) => watches.count())
          .all()

        expect(rows.map((row) => Reflect.get(row, 'watches'))).toEqual([1, 1])
        expect(stranger.map((row) => 'watches' in row)).toEqual([false, false])
      },
      BOOT,
    )
  })

  describe('a sibling count of the relation a rule reads', () => {
    const noteCount: Refinement = (rows) => rows.count()

    test(
      'decides a sibling relation the way the same read without it does',
      async () => {
        const without = await ticketRead().include('attachments').all()
        const beside = await ticketRead().include('attachments').include('notes', noteCount).all()

        expect(without.map((row) => 'attachments' in row)).toEqual([false, false])
        expect(beside.map((row) => 'attachments' in row)).toEqual([false, false])
      },
      BOOT,
    )

    test(
      'decides a to-one and its foreign key the way the same read without it does',
      async () => {
        const without = await ticketRead().include('assignee').all()
        const beside = await ticketRead().include('assignee').include('notes', noteCount).all()

        expect(beside.map((row) => 'assignee' in row)).toEqual(
          without.map((row) => 'assignee' in row),
        )
        expect(beside.map((row) => Reflect.get(row, 'assigneeId'))).toEqual([null, null])
        expect(without.map((row) => Reflect.get(row, 'assigneeId'))).toEqual([null, null])
      },
      BOOT,
    )

    test(
      'decides an un-included foreign key the way the same read without it does',
      async () => {
        const without = await ticketRead().all()
        const beside = await ticketRead().include('notes', noteCount).all()

        expect(beside.map((row) => Reflect.get(row, 'assigneeId'))).toEqual([null, null])
        expect(without.map((row) => Reflect.get(row, 'assigneeId'))).toEqual([null, null])
      },
      BOOT,
    )

    test(
      'decides a scalar field the way the same read without it does',
      async () => {
        const without = await ticketRead().all()
        const beside = await ticketRead().include('notes', noteCount).all()

        expect(without.map((row) => 'summary' in row)).toEqual([false, false])
        expect(beside.map((row) => 'summary' in row)).toEqual([false, false])
      },
      BOOT,
    )

    test(
      'holds at depths two and three',
      async () => {
        const context = db.context({ userId: 'owner' })
        const depthTwo = await context.db.Project.include('tickets', (tickets) =>
          tickets.include('assignee').include('attachments').include('notes', noteCount),
        ).all()
        const depthThree = await context.db.Org.include('projects', (projects) =>
          projects.include('tickets', (tickets) =>
            tickets.include('assignee').include('attachments').include('notes', noteCount),
          ),
        ).all()
        const reachedAtThree = (depthThree[0].projects as Rows)[0].tickets as Rows

        for (const tickets of [depthTwo[0].tickets as Rows, reachedAtThree]) {
          expect(tickets).toHaveLength(2)
          for (const ticket of tickets) {
            expect(ticket).not.toHaveProperty('attachments')
            expect(ticket).not.toHaveProperty('assignee')
            expect(ticket).not.toHaveProperty('summary')
            expect(ticket.assigneeId).toBeNull()
          }
        }
      },
      BOOT,
    )

    const assignees = (tickets: unknown) =>
      (tickets as Rows).map((ticket) => ticket.assigneeId !== null)

    test(
      'an un-included foreign key at depth two reads the rule view of its own level',
      async () => {
        const context = db.context({ userId: 'owner' })
        const counted = await context.db.Project.include('tickets', (tickets) =>
          tickets.orderBy({ name: 'asc' }).include('notes', noteCount),
        ).all()
        const delivered = await context.db.Project.include('tickets', (tickets) =>
          tickets.orderBy({ name: 'asc' }).include('notes'),
        ).all()

        expect(assignees(delivered[0].tickets)).toEqual([true, false])
        expect(assignees(counted[0].tickets)).toEqual([false, false])
        expect((counted[0].tickets as Rows).map((ticket) => ticket.reviewerId)).toEqual([
          null,
          null,
        ])
      },
      BOOT,
    )

    test(
      'an un-included foreign key at depth three reads the rule view of its own level',
      async () => {
        const context = db.context({ userId: 'owner' })
        const counted = await context.db.Org.include('projects', (projects) =>
          projects.include('tickets', (tickets) =>
            tickets.orderBy({ name: 'asc' }).include('notes', noteCount),
          ),
        ).all()
        const delivered = await context.db.Org.include('projects', (projects) =>
          projects.include('tickets', (tickets) =>
            tickets.orderBy({ name: 'asc' }).include('notes'),
          ),
        ).all()

        expect(assignees((delivered[0].projects as Rows)[0].tickets)).toEqual([true, false])
        expect(assignees((counted[0].projects as Rows)[0].tickets)).toEqual([false, false])
      },
      BOOT,
    )

    test(
      'a delivered relation still decides on its rows, row by row',
      async () => {
        const rows = await ticketRead().include('notes').include('attachments').all()

        expect(rows.map((row) => 'attachments' in row)).toEqual([true, false])
        expect(rows.map((row) => 'summary' in row)).toEqual([true, false])
      },
      BOOT,
    )
  })

  describe('a rule reading absence as permission', () => {
    test(
      'decides on rows when they are delivered',
      async () => {
        const rows = await ticketRead().include('memos').include('notes').all()

        expect(rows.map((row) => 'memos' in row)).toEqual([true, false])
        expect(rows.map((row) => 'absent' in row)).toEqual([true, false])
      },
      BOOT,
    )

    test(
      'denies on a bare read',
      async () => {
        const rows = await ticketRead().all()

        expect(rows.map((row) => 'absent' in row)).toEqual([false, false])
        expect(rows.map((row) => Reflect.get(row, 'reviewerId'))).toEqual([null, null])
      },
      BOOT,
    )

    test.each(shaped)(
      'denies under %s',
      async (_, refine) => {
        const rows = await ticketRead().include('memos', refine).all()

        expect(rows.map((row) => 'memos' in row)).toEqual([false, false])
      },
      BOOT,
    )

    test.each(rowless)(
      'denies under %s',
      async (_, refine) => {
        const rows = await ticketRead().include('memos', refine).all()

        expect(rows.map((row) => 'memos' in row)).toEqual([false, false])
      },
      BOOT,
    )

    test.each(shaped)(
      'a foreign key decided by it denies beside %s',
      async (_, refine) => {
        const rows = await ticketRead().include('notes', refine).all()

        expect(rows.map((row) => Reflect.get(row, 'reviewerId'))).toEqual([null, null])
      },
      BOOT,
    )
  })

  describe('a null relation that really was fetched', () => {
    test(
      'is a real answer, not a withheld one',
      async () => {
        const admin = db.context({}).sudo()
        const created = await admin.db.Case.create({ data: { name: 'empty', summary: 'SUMMARY' } })
        const rows = await db
          .context({})
          .db.Case.where({ id: { equals: String(created!.id) } })
          .include('entries')
          .all()

        expect(rows[0]).toMatchObject({ summary: 'SUMMARY', entries: [] })
      },
      BOOT,
    )

    test(
      'a rule on an included to-one sees null and decides on it',
      async () => {
        const admin = db.context({}).sudo()
        await admin.db.Ticket.create({ data: { name: 'orphan', ownerId: 'owner' } })
        const orphan = await db
          .context({ userId: 'owner' })
          .db.Ticket.where({ name: { equals: 'orphan' } })
          .include('assignee')
          .include('notes')
          .first()

        expect(orphan).toMatchObject({ assignee: null, assigneeId: null })
      },
      BOOT,
    )
  })

  describe('a rule that never reads the relation', () => {
    test(
      'behaves as it did, beside every reduction',
      async () => {
        for (const [, refine] of rowless) {
          const rows = await ticketRead().include('notes', refine).all()
          const stranger = await db
            .context({ userId: 'stranger' })
            .db.Ticket.orderBy({ name: 'asc' })
            .include('notes', refine)
            .all()

          expect(rows.map((row) => row.owned)).toEqual(['OWNED', 'OWNED'])
          expect(stranger.map((row) => 'owned' in row)).toEqual([false, false])
        }
      },
      BOOT,
    )
  })

  describe('every terminal takes the same decision', () => {
    test(
      'first()',
      async () => {
        const row = await ticketRead()
          .where({ name: { equals: 'mixed' } })
          .include('notes', (rows) => rows.count())
          .first()

        expect(row).not.toBeNull()
        expect(row).not.toHaveProperty('notes')
        expect(row).not.toHaveProperty('absent')
      },
      BOOT,
    )

    test(
      'forUpdate()',
      async () => {
        const rows = await db.context({ userId: 'owner' }).transaction(async (tx) =>
          tx.db.Ticket.orderBy({ name: 'asc' })
            .include('notes', (notes) => notes.count())
            .forUpdate()
            .all(),
        )

        expect(rows).toHaveLength(2)
        expect(rows.map((row) => 'notes' in row)).toEqual([false, false])
        expect(rows.map((row) => Reflect.get(row, 'assigneeId'))).toEqual([null, null])
      },
      BOOT,
    )

    test(
      'a write on a list declaring no relation returns what a bare first() does',
      async () => {
        const context = db.context({ userId: 'owner' })
        const created = await context.db.Ticket.create({
          data: { name: 'written', ownerId: 'owner', absent: 'ABSENT', owned: 'OWNED' },
        })
        const read = await context.db.Ticket.where({ id: { equals: String(created!.id) } }).first()
        const updated = await context.db.Ticket.update({
          where: { id: created!.id },
          data: { name: 'written' },
        })
        const deleted = await context.db.Ticket.delete({ where: { id: created!.id } })

        expect(created).toEqual(read)
        expect(updated).toEqual(read)
        expect(deleted).toEqual(read)
        expect(read).not.toHaveProperty('absent')
        expect(read).toMatchObject({ owned: 'OWNED' })
      },
      BOOT,
    )

    test(
      'a write on a list declaring a relation decides on those rows, as first() does',
      async () => {
        const context = db.context({})
        const [mixed] = await context.db.Case.where({ name: { equals: 'mixed' } }).all()
        const [clean] = await context.db.Case.where({ name: { equals: 'all-public' } }).all()

        const updatedMixed = await context.db.Case.update({
          where: { id: mixed.id },
          data: { name: 'mixed' },
        })
        const updatedClean = await context.db.Case.update({
          where: { id: clean.id },
          data: { name: 'all-public' },
        })

        expect(updatedMixed).not.toHaveProperty('summary')
        expect(updatedClean).toMatchObject({ summary: 'SUMMARY', entryCount: 2 })
      },
      BOOT,
    )
  })

  describe('rows the engine already has stay what the rule sees', () => {
    test.each(rowless)(
      '%s beside a live declared dependency decides on the declared rows',
      async (_, refine) => {
        const rows = await db
          .context({})
          .db.Case.orderBy({ name: 'asc' })
          .include('entries', refine)
          .all()

        expect(rows.map((row) => 'entries' in row)).toEqual([true, false])
        expect(rows.map((row) => 'summary' in row)).toEqual([true, false])
      },
      BOOT,
    )

    test(
      'a foreign-key rule and a scalar rule read the same declared rows',
      async () => {
        const rows = await db
          .context({})
          .db.Case.orderBy({ name: 'asc' })
          .include('entries', (entries) => entries.limit(0))
          .all()

        expect(rows.map((row) => 'summary' in row)).toEqual([true, false])
        expect(rows.map((row) => Reflect.get(row, 'reviewerId') !== null)).toEqual([true, false])
      },
      BOOT,
    )

    test(
      'with the declaring field projected away the rule is withheld them',
      async () => {
        const rows = await db
          .context({})
          .db.Case.orderBy({ name: 'asc' })
          .select('name', 'summary')
          .include('entries', (entries) => entries.count())
          .all()

        expect(rows.map((row) => 'summary' in row)).toEqual([false, false])
        expect(rows.map((row) => 'entries' in row)).toEqual([false, false])
      },
      BOOT,
    )
  })

  describe('a rule reaching past the row it was handed', () => {
    test(
      'denies on a relation the related row does not carry',
      async () => {
        const rows = await ticketRead().include('project').all()

        expect(rows.map((row) => 'peerCount' in row)).toEqual([false, false])
      },
      BOOT,
    )

    test(
      'denies on a count standing in one level down',
      async () => {
        const rows = await ticketRead()
          .include('project', (project) => project.include('tickets', (t) => t.count()))
          .all()

        expect(rows.map((row) => 'peerCount' in row)).toEqual([false, false])
      },
      BOOT,
    )
  })

  describe('a synthetic back-relation', () => {
    test(
      'is withheld like a declared one',
      async () => {
        const bare = await db.context({}).db.Shelf.orderBy({ name: 'asc' }).all()
        const delivered = await db
          .context({})
          .db.Shelf.orderBy({ name: 'asc' })
          .include('from_Book_shelf')
          .all()

        expect(bare.map((row) => 'label' in row)).toEqual([false, false])
        expect(delivered.map((row) => 'label' in row)).toEqual([true, false])
      },
      BOOT,
    )

    test.each(shaped.filter(([name]) => name === 'select' || name === 'where'))(
      'denies under a %s on it',
      async (_, refine) => {
        const rows = await db
          .context({})
          .db.Shelf.orderBy({ name: 'asc' })
          .include('from_Book_shelf', refine)
          .all()

        expect(rows.map((row) => 'label' in row)).toEqual([false, false])
      },
      BOOT,
    )

    test(
      "a select on it cannot narrow past the source field's rule",
      async () => {
        const rows = await db
          .context({})
          .db.Shelf.where({ name: { equals: 'mixed' } })
          .include('from_Book_shelf', (books) => books.select('body'))
          .all()

        expect(rows[0].from_Book_shelf).toHaveLength(1)
      },
      BOOT,
    )

    test(
      "the source field's rule still filters the related rows one by one",
      async () => {
        const rows = await db
          .context({})
          .db.Shelf.where({ name: { equals: 'mixed' } })
          .include('from_Book_shelf')
          .all()

        expect((rows[0].from_Book_shelf as Rows).map((row) => row.public)).toEqual([true])
      },
      BOOT,
    )
  })

  describe("a synthetic back-relation's source rule", () => {
    test(
      'denies a related row that does not carry what the rule reads',
      async () => {
        const admin = db.context({}).sudo()
        const box = await admin.db.Box.create({ data: { name: 'box' } })
        await admin.db.Part.create({ data: { name: 'p', box: { connect: { id: box!.id } } } })

        const rows = await db.context({}).db.Box.include('from_Part_box').all()

        expect(rows[0].from_Part_box).toEqual([])
      },
      BOOT,
    )

    test(
      "denies beside a count of what it reads, rather than deciding on the count's stand-in",
      async () => {
        const admin = db.context({}).sudo()
        const box = await admin.db.Box.create({ data: { name: 'box' } })
        await admin.db.Part.create({ data: { name: 'p', box: { connect: { id: box!.id } } } })

        const rows = await db
          .context({})
          .db.Box.include('from_Part_box', (parts) => parts.include('tags', (tags) => tags.count()))
          .all()
        const delivered = await db
          .context({})
          .db.Box.include('from_Part_box', (parts) => parts.include('tags'))
          .all()

        expect(rows[0].from_Part_box).toEqual([])
        expect(delivered[0].from_Part_box).toHaveLength(1)
      },
      BOOT,
    )
  })

  describe('a rule that throws', () => {
    test(
      'denies when what it reached for was withheld',
      async () => {
        const plain = await ticketRead()
          .include('logs', (logs) => logs.limit(5))
          .all()
        const counted = await ticketRead()
          .include('logs', (logs) => logs.count())
          .all()

        expect(plain.map((row) => 'logs' in row)).toEqual([false, false])
        expect(counted.map((row) => 'logs' in row)).toEqual([false, false])
      },
      BOOT,
    )

    test(
      'propagates a failure of its own',
      async () => {
        const admin = db.context({}).sudo()
        await admin.db.Broken.create({ data: { name: 'b', ownBug: 'x' } })

        await expect(db.context({}).db.Broken.select('name', 'ownBug').all()).rejects.toThrow(
          'a bug of the rule’s own',
        )
      },
      BOOT,
    )

    test(
      'propagates anything but the TypeError a withheld key causes',
      async () => {
        const admin = db.context({}).sudo()
        await admin.db.Broken.create({ data: { name: 'c', afterWithheld: 'x' } })

        await expect(
          db.context({}).db.Broken.select('name', 'afterWithheld').all(),
        ).rejects.toThrow('a failure after the reach')
      },
      BOOT,
    )

    test(
      'a non-boolean answer stays the loud failure it is',
      async () => {
        const admin = db.context({}).sudo()
        await admin.db.Broken.create({ data: { name: 'b', filterResult: 'x' } })

        await expect(db.context({}).db.Broken.select('name', 'filterResult').all()).rejects.toThrow(
          InvalidFieldAccessResultError,
        )
      },
      BOOT,
    )
  })

  describe('a rule cannot write through the item', () => {
    test(
      'a write denies that rule, and the next rule and the result never see it',
      async () => {
        const admin = db.context({}).sudo()
        const parent = await admin.db.Guarded.create({
          data: { name: 'original', first: 'FIRST', second: 'SECOND', sibling: 'SIBLING' },
        })
        await admin.db.GuardedItem.create({
          data: { body: 'x', parent: { connect: { id: parent!.id } } },
        })

        const row = await db.context({}).db.Guarded.include('items').first()

        expect(mutatorRan).toBe(1)
        expect(row).not.toHaveProperty('first')
        expect(row).not.toHaveProperty('items')
        expect(row).toMatchObject({ name: 'original', second: 'SECOND', sibling: 'SIBLING' })
      },
      BOOT,
    )
  })

  test(
    'sudo evaluates no rule, so nothing is withheld from it',
    async () => {
      const rows = await db
        .context({})
        .sudo()
        .db.Ticket.orderBy({ name: 'asc' })
        .include('notes', (notes) => notes.count())
        .all()

      expect(rows.map((row) => Reflect.get(row, 'notes'))).toEqual([2, 2])
      expect(rows.map((row) => row.summary)).toEqual(['SUMMARY', 'SUMMARY'])
    },
    BOOT,
  )
})
