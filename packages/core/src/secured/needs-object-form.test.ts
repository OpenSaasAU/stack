import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import type { Session } from '../access/types.js'
import type { BaseFieldConfig, OpenSaasConfig, TypeInfo } from '../config/types.js'
import { relationship, text, virtual } from '../fields/index.js'
import { z } from 'zod'
import { createMcpHandlers } from '../mcp/handler.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { createPlanRecorder } from '../testing/plans.js'

const BOOT = 120_000
const open = { query: () => true, create: () => true, update: () => true, delete: () => true }

const visible = {
  ...open,
  query: ({ session }: { session: Session | null }) =>
    session?.role === 'staff' ? true : { hidden: { equals: 'no' } },
}

const seen = new Map<string, unknown>()
const chainRuns: string[] = []

/** A virtual field that records the `item` its hook was handed. */
function probe(key: string, needs: BaseFieldConfig<TypeInfo>['needs']) {
  return virtual({
    type: 'string',
    needs,
    hooks: {
      resolveOutput: ({ item }) => {
        seen.set(key, item)
        chainRuns.push(key)
        return JSON.stringify(item)
      },
    },
  })
}

function moneyField(): BaseFieldConfig<TypeInfo> {
  return {
    type: 'money',
    outputType: '{ amount: string; currency: string }',
    getZodSchema: () =>
      z.object({ amount: z.string(), currency: z.string() }).nullable().optional(),
    getContractField: (fieldName) => ({
      kind: 'columns',
      columns: ['amount', 'currency'].map((part) => ({
        name: `${fieldName}_${part}`,
        type: { pack: 'pg', type: 'text' },
        nullable: true,
      })),
    }),
    getColumnNames: (fieldName) => [`${fieldName}_amount`, `${fieldName}_currency`],
    assembleColumns: (fieldName, row) => ({
      amount: row[`${fieldName}_amount`],
      currency: row[`${fieldName}_currency`],
    }),
    splitColumns: (fieldName, value) => {
      const { amount, currency } = Object(value)
      return { [`${fieldName}_amount`]: amount, [`${fieldName}_currency`]: currency }
    },
  }
}

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  mcp: { enabled: true, basePath: '/api/mcp' },
  lists: {
    Attendance: {
      fields: {
        note: text(),
        enrolment: relationship({ ref: 'Enrolment.attendances' }),
        label: probe('Attendance.label', {
          enrolment: { student: true, classTerm: ['class', 'term'] },
        }),
        oneHop: probe('Attendance.oneHop', ['enrolment']),
        picky: probe('Attendance.picky', { note: true, enrolment: ['ref'] }),
        guarded: text({
          access: {
            read: ({ item }) => {
              const enrolment: unknown = item.enrolment
              if (typeof enrolment !== 'object' || enrolment === null) return false
              return Reflect.get(enrolment, 'student') === null
            },
          },
        }),
      },
      access: { operation: open },
    },
    Enrolment: {
      fields: {
        ref: text(),
        attendances: relationship({ ref: 'Attendance.enrolment', many: true }),
        student: relationship({ ref: 'Student', access: { read: () => false } }),
        classTerm: relationship({ ref: 'ClassTerm' }),
        roll: probe('Enrolment.roll', { attendances: { enrolment: { attendances: true } } }),
        chained: probe('Enrolment.chained', ['student']),
        sealed: virtual({
          type: 'string',
          access: { read: ({ item }) => item.classTerm !== null },
          hooks: { resolveOutput: () => 'sealed' },
        }),
      },
      access: { operation: open },
    },
    Student: {
      fields: {
        name: text(),
        hidden: text(),
        fee: moneyField(),
        enrolments: probe('Student.enrolments', { from_Enrolment_student: ['classTerm', 'ref'] }),
        arrayEnrolments: probe('Student.arrayEnrolments', ['from_Enrolment_student']),
        fees: probe('Student.fees', { from_Enrolment_student: { student: ['fee'] } }),
      },
      access: { operation: visible },
    },
    ClassTerm: {
      fields: {
        code: text(),
        class: relationship({ ref: 'Class' }),
        term: relationship({ ref: 'Term' }),
      },
      access: { operation: open },
    },
    Class: { fields: { title: text(), hidden: text() }, access: { operation: visible } },
    Term: { fields: { name: text(), hidden: text() }, access: { operation: visible } },
  },
}

type TestContext = ReturnType<TestDatabase['context']>

function idOf(row: Record<string, unknown> | null): string {
  if (row === null || typeof row.id !== 'string') throw new Error('expected a row with an id')
  return row.id
}

const connect = (id: string) => ({ connect: { id } })

describe('a shaped include of a declared relation', () => {
  const shapedConfig: OpenSaasConfig = {
    db: { provider: 'postgresql' },
    lists: {
      Shelf: {
        fields: {
          name: text({
            access: { read: ({ item }) => Array.isArray(item.books) && item.books.length === 0 },
          }),
          books: relationship({ ref: 'Book.shelf', many: true }),
          titles: virtual({
            type: 'number',
            needs: { books: { shelf: true } },
            hooks: {
              resolveOutput: ({ item }) => {
                if (!Array.isArray(item.books)) throw new TypeError('item.books is not an array')
                return item.books.length
              },
            },
          }),
        },
        access: { operation: open },
      },
      Book: {
        fields: { title: text(), shelf: relationship({ ref: 'Shelf.books' }) },
        access: { operation: open },
      },
    },
  }

  test(
    'a row gone between the two statements is empty to the hook, and grants no rule',
    async () => {
      let armed = -1
      const db = await createTestDatabase(shapedConfig, {
        middleware: [
          {
            name: 'delete-between',
            familyId: 'sql',
            async beforeCompile() {
              if (armed < 0 || armed-- !== 0) return undefined
              await db
                .context({})
                .sudo()
                .db.Shelf.delete({ where: { id: shelf } })
              return undefined
            },
          },
        ],
      })
      let shelf = ''
      try {
        shelf = idOf(
          await db
            .context({})
            .sudo()
            .db.Shelf.create({ data: { name: 'secret' } }),
        )
        armed = 1
        const rows = await db
          .context({})
          .db.Shelf.include('books', (books) => books.limit(1))
          .all()
        expect(armed).toBe(-1)
        expect(rows).toEqual([{ id: shelf, titles: 0, books: [] }])
      } finally {
        await db.close()
      }
    },
    BOOT,
  )

  test(
    'a page past the bind-parameter cap still reads',
    async () => {
      const db = await createTestDatabase(shapedConfig)
      try {
        const pool = new pg.Pool({ connectionString: db.url, max: 1 })
        try {
          await pool.query(
            `INSERT INTO "Shelf" (id, name) SELECT gen_random_uuid(), 'n' FROM generate_series(1, 70000)`,
          )
        } finally {
          await pool.end()
        }
        for (const shape of [false, true]) {
          const rows = await db
            .context({})
            .db.Shelf.select('titles')
            .include('books', (books) => (shape ? books.limit(1) : books))
            .all()
          expect(rows).toHaveLength(70_000)
        }
      } finally {
        await db.close()
      }
    },
    BOOT,
  )
})

describe('the object form of needs', () => {
  const recorder = createPlanRecorder()
  let database: TestDatabase
  let staff: TestContext
  let parent: TestContext
  let enrolmentId: string
  let studentId: string
  let attendanceId: string

  beforeAll(async () => {
    database = await createTestDatabase(config, { middleware: [recorder.middleware] })
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  async function enrol(
    hidden: { student?: string; class?: string; term?: string } = {},
  ): Promise<{ enrolment: string; student: string; attendance: string }> {
    const student = idOf(
      await staff.db.Student.create({
        data: {
          name: 'Ada',
          hidden: hidden.student ?? 'no',
          fee: { amount: '5', currency: 'AUD' },
        },
      }),
    )
    const cls = idOf(
      await staff.db.Class.create({ data: { title: 'Ballet', hidden: hidden.class ?? 'no' } }),
    )
    const term = idOf(
      await staff.db.Term.create({ data: { name: 'T1', hidden: hidden.term ?? 'no' } }),
    )
    const classTerm = idOf(
      await staff.db.ClassTerm.create({
        data: { code: 'B1', class: connect(cls), term: connect(term) },
      }),
    )
    const enrolment = idOf(
      await staff.db.Enrolment.create({
        data: { ref: 'E', student: connect(student), classTerm: connect(classTerm) },
      }),
    )
    const attendance = idOf(
      await staff.db.Attendance.create({
        data: { note: 'n', guarded: 'secret', enrolment: connect(enrolment) },
      }),
    )
    return { enrolment, student, attendance }
  }

  beforeEach(async () => {
    await database.truncate()
    staff = database.context({ userId: 'u1', role: 'staff' })
    parent = database.context({ userId: 'u2', role: 'parent' })
    const ids = await enrol()
    enrolmentId = ids.enrolment
    studentId = ids.student
    attendanceId = ids.attendance
    seen.clear()
    chainRuns.length = 0
    recorder.clear()
  })

  const fullLabel = {
    id: expect.any(String),
    enrolmentId: expect.any(String),
    enrolment: {
      id: expect.any(String),
      studentId: expect.any(String),
      classTermId: expect.any(String),
      student: {
        id: expect.any(String),
        name: 'Ada',
        hidden: 'no',
        fee: { amount: '5', currency: 'AUD' },
      },
      classTerm: {
        id: expect.any(String),
        classId: expect.any(String),
        termId: expect.any(String),
        class: { id: expect.any(String), title: 'Ballet', hidden: 'no' },
        term: { id: expect.any(String), name: 'T1', hidden: 'no' },
      },
    },
  }

  test('three hops reach the hook as exactly what was spelled out', async () => {
    const [row] = await staff.db.Attendance.all()
    expect(seen.get('Attendance.label')).toEqual(fullLabel)
    expect(row).not.toHaveProperty('enrolment')
  })

  test('a projection naming only the computed field reaches the same item', async () => {
    await staff.db.Attendance.select('label').all()
    expect(seen.get('Attendance.label')).toEqual(fullLabel)
  })

  test.each([
    ['include', () => staff.db.Enrolment.include('attendances').all()],
    [
      'a shaped include',
      () => staff.db.Enrolment.include('attendances', (rows) => rows.limit(5)).all(),
    ],
    [
      'a combine rows branch',
      () =>
        staff.db.Enrolment.include('attendances', (rows) =>
          rows.combine({ rows: rows.limit(5), total: rows.count() }),
        ).all(),
    ],
    ['the caller naming the relation', () => staff.db.Attendance.include('enrolment').all()],
    [
      'the caller shaping the relation',
      () => staff.db.Attendance.include('enrolment', (rows) => rows.select('ref')).all(),
    ],
    [
      'the caller refining the relation away',
      () =>
        staff.db.Attendance.include('enrolment', (rows) =>
          rows.where({ ref: { equals: 'nope' } }),
        ).all(),
    ],
    [
      'the caller reaching two hops',
      () => staff.db.Attendance.include('enrolment', (rows) => rows.include('classTerm')).all(),
    ],
    [
      'update',
      () => staff.db.Attendance.update({ where: { id: attendanceId }, data: { note: 'm' } }),
    ],
    ['delete', () => staff.db.Attendance.delete({ where: { id: attendanceId } })],
    [
      'forUpdate',
      () =>
        staff.transaction((tx) =>
          tx.db.Attendance.where({ id: { equals: attendanceId } })
            .forUpdate()
            .first(),
        ),
    ],
  ])('%s delivers the same item', async (_lane, run) => {
    await run()
    expect(seen.get('Attendance.label')).toEqual(fullLabel)
  })

  test('create delivers the same item', async () => {
    await staff.db.Attendance.create({ data: { note: 'x', enrolment: connect(enrolmentId) } })
    expect(seen.get('Attendance.label')).toEqual(fullLabel)
  })

  test('MCP delivers the same item', async () => {
    const handlers = createMcpHandlers({
      config,
      getSession: async () => ({ userId: 'u1', clientId: 'client-1', role: 'staff' }),
      getContext: async () => staff,
    })
    const response = await handlers.POST(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_attendance_query', arguments: { fields: { label: true } } },
        }),
      }),
    )
    expect(response.status).toBe(200)
    expect(seen.get('Attendance.label')).toEqual(fullLabel)
  })

  test('a field sees its own declaration, not a deeper sibling’s', async () => {
    for (const read of [
      staff.db.Attendance,
      staff.db.Attendance.include('enrolment'),
      staff.db.Enrolment.include('attendances'),
    ]) {
      seen.clear()
      await read.all()
      expect(seen.get('Attendance.oneHop')).toEqual({
        id: expect.any(String),
        enrolmentId,
        enrolment: {
          id: enrolmentId,
          ref: 'E',
          studentId,
          classTermId: expect.any(String),
        },
      })
      expect(seen.get('Attendance.picky')).toEqual({
        id: expect.any(String),
        note: 'n',
        enrolmentId,
        enrolment: { id: enrolmentId, ref: 'E' },
      })
    }
  })

  test.each([
    ['a bare read', () => staff.db.Attendance.all()],
    ['an included to-many', () => staff.db.Enrolment.include('attendances').all()],
    ['the caller’s own include', () => staff.db.Attendance.include('enrolment').all()],
    [
      'a nested include beneath the relation',
      () =>
        staff.db.Enrolment.include('attendances', (rows) =>
          rows.include('enrolment', (enrolment) => enrolment.include('classTerm')),
        ).all(),
    ],
    [
      'a shaped include',
      () => staff.db.Attendance.include('enrolment', (rows) => rows.select('ref')).all(),
    ],
  ])('%s costs the same number of queries at any row count', async (_lane, run) => {
    await run()
    const few = recorder.plans.length
    for (const more of [5, 10]) {
      for (let i = 0; i < more; i++) await enrol()
      recorder.clear()
      await run()
      expect(recorder.plans.length).toBe(few)
    }
  })

  test('a plain include costs no query the bare read does not', async () => {
    await staff.db.Attendance.select('label').all()
    const bare = recorder.plans.length
    recorder.clear()
    await staff.db.Attendance.select('label').include('enrolment').all()
    expect(recorder.plans.length).toBe(bare)
  })

  test('a relation one level declared is not for the next level’s read rules', async () => {
    const [row] = await staff.db.Attendance.include('enrolment').all()
    expect(row).toMatchObject({ enrolment: { ref: 'E' } })
    expect(row.enrolment).not.toHaveProperty('sealed')
    const [own] = await staff.db.Enrolment.include('classTerm').all()
    expect(own).toHaveProperty('sealed', 'sealed')
  })

  test('a scoped-away hop is null at any depth, and delivers nothing beneath it', async () => {
    await database.truncate()
    await enrol({ student: 'yes', class: 'yes' })

    await staff.db.Attendance.all()
    expect(seen.get('Attendance.label')).toMatchObject({
      enrolment: {
        student: { name: 'Ada' },
        classTerm: { class: { title: 'Ballet' }, term: { name: 'T1' } },
      },
    })

    await parent.db.Attendance.all()
    expect(seen.get('Attendance.label')).toMatchObject({
      enrolment: { student: null, classTerm: { class: null, term: { name: 'T1' } } },
    })
    expect(JSON.stringify(seen.get('Attendance.label'))).not.toMatch(/Ada|Ballet/)

    seen.clear()
    await parent.db.Attendance.include('enrolment', (rows) => rows.select('ref')).all()
    expect(seen.get('Attendance.label')).toMatchObject({
      enrolment: { student: null, classTerm: { class: null, term: { name: 'T1' } } },
    })
  })

  test(
    'a scoped-away to-many hop is empty',
    async () => {
      const closed: OpenSaasConfig = {
        ...config,
        lists: {
          ...config.lists,
          Attendance: {
            ...config.lists.Attendance,
            access: { operation: { ...open, query: () => false } },
          },
        },
      }
      const db = await createTestDatabase(closed)
      try {
        const admin = db.context({}).sudo()
        const enrolment = idOf(await admin.db.Enrolment.create({ data: { ref: 'E' } }))
        await admin.db.Attendance.create({ data: { enrolment: connect(enrolment) } })
        await db.context({ userId: 'u' }).db.Enrolment.all()
        expect(seen.get('Enrolment.roll')).toMatchObject({ attendances: [] })
        await admin.db.Enrolment.all()
        expect(seen.get('Enrolment.roll')).toMatchObject({
          attendances: [{ enrolment: { attendances: [{}] } }],
        })
      } finally {
        await db.close()
      }
    },
    BOOT,
  )

  test('a cycle is bounded by what the declaration spells out', async () => {
    await staff.db.Enrolment.all()
    expect(seen.get('Enrolment.roll')).toEqual({
      id: enrolmentId,
      attendances: [
        {
          id: attendanceId,
          enrolmentId,
          enrolment: {
            id: enrolmentId,
            attendances: [{ id: attendanceId, note: 'n', guarded: 'secret', enrolmentId }],
          },
        },
      ],
    })
  })

  test('no computed field runs on a declared branch', async () => {
    await staff.db.Attendance.select('label').all()
    expect(chainRuns).toEqual(['Attendance.label'])
    chainRuns.length = 0
    await staff.db.Student.select('enrolments').all()
    expect(chainRuns).toEqual(['Student.enrolments'])
  })

  test('a synthetic back-relation is a key in both forms, and never reaches the caller', async () => {
    const [student] = await staff.db.Student.all()
    expect(seen.get('Student.enrolments')).toEqual({
      id: studentId,
      from_Enrolment_student: [
        {
          id: enrolmentId,
          ref: 'E',
          classTermId: expect.any(String),
          classTerm: {
            id: expect.any(String),
            code: 'B1',
            classId: expect.any(String),
            termId: expect.any(String),
          },
        },
      ],
    })
    expect(seen.get('Student.arrayEnrolments')).toMatchObject({
      from_Enrolment_student: [{ ref: 'E' }],
    })
    expect(student).not.toHaveProperty('from_Enrolment_student')
  })

  test('a declared synthetic back-relation opens nothing the caller’s read denial closes', async () => {
    const rows = await staff.db.Student.include('from_Enrolment_student').all()
    expect(rows[0]).not.toHaveProperty('from_Enrolment_student')
    const counted = await staff.db.Student.include('from_Enrolment_student', (enrolments) =>
      enrolments.count(),
    ).all()
    expect(counted[0]).not.toHaveProperty('from_Enrolment_student')
    expect(seen.get('Student.enrolments')).toMatchObject({ from_Enrolment_student: [{ ref: 'E' }] })
  })

  test('a multi-column field is assembled at any depth', async () => {
    await staff.db.Student.all()
    expect(seen.get('Student.fees')).toEqual({
      id: studentId,
      from_Enrolment_student: [
        {
          id: enrolmentId,
          studentId,
          student: { id: studentId, fee: { amount: '5', currency: 'AUD' } },
        },
      ],
    })
  })

  test('a read rule cannot see past one hop, so a scoped-away hop never reads as none', async () => {
    await database.truncate()
    await enrol({ student: 'yes' })
    const [row] = await parent.db.Attendance.all()
    expect(row).not.toHaveProperty('guarded')
  })
})
