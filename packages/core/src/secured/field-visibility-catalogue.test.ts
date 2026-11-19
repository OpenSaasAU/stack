// Reads and writes through the secured surface whose rows, rule and hook calls
// and statements `field-visibility-differential.test.ts` compares between the
// two Field Visibility implementations (#2408). Each entry is a test on its own.

import { writeFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import type { Session } from '../access/types.js'
import { checkbox, integer, json, relationship, text, virtual } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { createPlanRecorder, type RecordedPlan } from '../testing/plans.js'

const BOOT = 120_000

type Call = readonly unknown[]

const calls: Call[] = []

function record(...call: unknown[]): void {
  calls.push(call)
}

function keysOf(item: Record<string, unknown>): string[] {
  return Object.keys(item)
}

function avatar(): FieldConfig {
  const field = json()
  const columns = ['avatar_filename', 'avatar_filesize']
  field.getContractField = () => ({
    kind: 'columns',
    columns: [
      { name: columns[0], type: { pack: 'pg', type: 'text' }, nullable: true },
      { name: columns[1], type: { pack: 'pg', type: 'int' }, nullable: true },
    ],
  })
  field.getColumnNames = () => columns
  field.assembleColumns = (fieldName, row) => {
    record('assembleColumns', fieldName)
    return { filename: row[columns[0]], filesize: row[columns[1]] }
  }
  field.splitColumns = (_fieldName, value) => {
    const parts: { filename?: unknown; filesize?: unknown } =
      typeof value === 'object' && value !== null ? value : {}
    return { [columns[0]]: parts.filename ?? null, [columns[1]]: parts.filesize ?? null }
  }
  return field
}

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', idField: 'int autoincrement' },
  lists: {
    Org: {
      fields: { name: text(), listed: checkbox() },
      access: {
        operation: {
          query: () => {
            record('query', 'Org')
            return { listed: { equals: true } }
          },
        },
      },
    },
    Mentor: {
      fields: { name: text() },
      access: { operation: { query: () => false, create: () => true } },
    },
    Member: {
      fields: {
        name: text(),
        salary: integer({
          access: {
            read: ({ session, item }) => {
              record('read', 'Member.salary', item.name)
              return session?.role === 'admin'
            },
          },
        }),
        secret: text({
          access: {
            read: () => {
              record('read', 'Member.secret')
              return false
            },
          },
        }),
        badge: text({
          access: {
            read: ({ item }) => {
              record('read', 'Member.badge')
              return item.org !== null
            },
          },
        }),
        nickname: text({
          hooks: {
            resolveOutput: ({ value, item }) => {
              record('resolveOutput', 'Member.nickname', keysOf(item))
              return typeof value === 'string' ? value.toUpperCase() : value
            },
          },
        }),
        label: virtual({
          type: 'string',
          needs: ['name'],
          hooks: {
            resolveOutput: ({ item }) => {
              record('resolveOutput', 'Member.label', keysOf(item))
              return `member ${String(item.name)}`
            },
          },
        }),
        avatar: avatar(),
        org: relationship({
          ref: 'Org',
          access: {
            read: ({ session }) => {
              record('read', 'Member.org')
              return session !== null
            },
          },
        }),
        mentor: relationship({ ref: 'Mentor' }),
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
    Ledger: {
      fields: {
        amount: integer(),
        secretSauce: integer(),
        note: text({
          access: {
            read: ({ session }) => {
              record('read', 'Ledger.note')
              return session !== null
            },
          },
        }),
        total: virtual({
          type: 'number',
          needs: ['amount'],
          hooks: {
            resolveOutput: ({ item }) => {
              record('resolveOutput', 'Ledger.total', keysOf(item))
              return Number(item.amount) * 2
            },
          },
        }),
        expensive: virtual({
          type: 'number',
          needs: ['secretSauce'],
          hooks: {
            resolveOutput: ({ item }) => {
              record('resolveOutput', 'Ledger.expensive', keysOf(item))
              return Number(item.secretSauce) + 1
            },
          },
        }),
      },
      access: { operation: { query: () => true } },
    },
    Sealed: {
      fields: { name: text() },
      access: { operation: { query: () => false, create: () => true } },
    },
    Order: {
      fields: {
        ref: text(),
        lines: relationship({ ref: 'Line.order', many: true }),
        total: virtual({
          type: 'number',
          needs: ['lines'],
          hooks: {
            resolveOutput: ({ item }) => {
              record('resolveOutput', 'Order.total', keysOf(item))
              const lines: unknown = item.lines
              return Array.isArray(lines) ? lines.length : -1
            },
          },
        }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
    Line: {
      fields: { price: integer(), order: relationship({ ref: 'Order.lines' }) },
      access: { operation: { query: () => true, create: () => true } },
    },
  },
}

const recorder = createPlanRecorder()
let database: TestDatabase

const member: Session = { role: 'member' }
const admin: Session = { role: 'admin' }

/** What the differential compares: the result, then every call and statement it took, in order. */
export interface Observation {
  readonly result: unknown
  readonly calls: readonly Call[]
  readonly statements: readonly string[]
}

const observations: Record<string, Observation> = {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function projectedColumns(plan: RecordedPlan): string[] {
  const projection: unknown = isRecord(plan.ast) ? plan.ast.projection : undefined
  if (!Array.isArray(projection)) return []
  return projection.flatMap((item) =>
    isRecord(item) && typeof item.alias === 'string' ? [item.alias] : [],
  )
}

function statement(plan: RecordedPlan): string {
  return `${plan.kind}:${String(plan.origin)}:${projectedColumns(plan).join(',')}`
}

async function seedMembers(): Promise<void> {
  const sudo = database.context(null).sudo().db
  await sudo.Org.create({ data: { name: 'listed', listed: true } })
  await sudo.Org.create({ data: { name: 'unlisted', listed: false } })
  await sudo.Mentor.create({ data: { name: 'yoda' } })
  await sudo.Member.create({
    data: {
      name: 'ada',
      salary: 100,
      secret: 's1',
      badge: 'gold',
      nickname: 'addy',
      avatar: { filename: 'ada.png', filesize: 12 },
      org: { connect: { id: 1 } },
      mentor: { connect: { id: 1 } },
    },
  })
  await sudo.Member.create({
    data: { name: 'bob', salary: 50, secret: 's2', badge: 'tin', org: { connect: { id: 2 } } },
  })
  await sudo.Member.create({ data: { name: 'cy', salary: 10, badge: 'none' } })
}

async function seedLedger(): Promise<void> {
  await database
    .context(null)
    .sudo()
    .db.Ledger.create({ data: { amount: 3, secretSauce: 41, note: 'n' } })
}

/**
 * Runs one catalogue entry, keeps what it observed for the differential, and
 * hands back the result for the entry's own assertion.
 */
async function observe(name: string, run: () => Promise<unknown>): Promise<unknown> {
  calls.length = 0
  recorder.clear()
  const result = await run()
  observations[name] = {
    result: JSON.parse(JSON.stringify(result ?? null)),
    calls: calls.map((call) => [...call]),
    statements: recorder.plans.map(statement),
  }
  return result
}

beforeAll(async () => {
  database = await createTestDatabase(config, { middleware: [recorder.middleware] })
}, BOOT)

afterAll(async () => {
  await database?.close()
  const out = process.env.OPENSAAS_FIELD_VISIBILITY_CATALOGUE_OUT
  if (out !== undefined && out !== '') writeFileSync(out, JSON.stringify(observations))
})

beforeEach(async () => {
  await database.truncate()
})

const ada = {
  id: 1,
  name: 'ada',
  nickname: 'ADDY',
  avatar: { filename: 'ada.png', filesize: 12 },
  orgId: 1,
  mentorId: null,
  label: 'member ada',
}

describe('bare reads', () => {
  test('all() as a member strips denied fields, narrows foreign keys and computes', async () => {
    await seedMembers()

    const rows = await observe('bare all() as a member', () =>
      database.context(member).db.Member.orderBy({ id: 'asc' }).all(),
    )

    expect(rows).toEqual([
      ada,
      {
        ...ada,
        id: 2,
        name: 'bob',
        nickname: null,
        avatar: { filename: null, filesize: null },
        orgId: null,
        label: 'member bob',
      },
      {
        ...ada,
        id: 3,
        name: 'cy',
        nickname: null,
        avatar: { filename: null, filesize: null },
        orgId: null,
        label: 'member cy',
      },
    ])
  })

  test('all() as an admin reads the salary its rule grants', async () => {
    await seedMembers()

    const rows = await observe('bare all() as an admin', () =>
      database
        .context(admin)
        .db.Member.where({ name: { equals: 'ada' } })
        .all(),
    )

    expect(rows).toEqual([{ ...ada, salary: 100 }])
  })

  test('first() anonymously nulls a foreign key whose field rule denies', async () => {
    await seedMembers()

    const row = await observe('bare first() anonymously', () =>
      database.context(null).db.Member.orderBy({ id: 'asc' }).first(),
    )

    expect(row).toEqual({ ...ada, orgId: null })
  })

  test('a sudo read skips every rule and the foreign-key pass', async () => {
    await seedMembers()

    const row = await observe('bare first() under sudo', () =>
      database.context(null).sudo().db.Member.orderBy({ id: 'asc' }).first(),
    )

    expect(row).toEqual({ ...ada, salary: 100, secret: 's1', badge: 'gold', mentorId: 1 })
  })

  test('a list with no relations computes every computed field from its declared set', async () => {
    await seedLedger()

    const rows = await observe('bare all() on a list with no relations', () =>
      database.context(member).db.Ledger.all(),
    )

    expect(rows).toEqual([
      { id: 1, amount: 3, secretSauce: 41, note: 'n', total: 6, expensive: 42 },
    ])
  })
})

describe('projections', () => {
  test('a projection runs only the rules and hooks of the fields it names', async () => {
    await seedMembers()

    const rows = await observe('select(name, label)', () =>
      database
        .context(member)
        .db.Member.select('name', 'label')
        .orderBy({ id: 'asc' })
        .limit(1)
        .all(),
    )

    expect(rows).toEqual([{ id: 1, name: 'ada', label: 'member ada' }])
  })

  test('an unselected computed field neither runs nor widens the fetch', async () => {
    await seedLedger()

    const rows = await observe('select(note, total) leaves expensive alone', () =>
      database.context(member).db.Ledger.select('note', 'total').all(),
    )

    expect(rows).toEqual([{ id: 1, note: 'n', total: 6 }])
    expect(calls).not.toContainEqual(expect.arrayContaining(['Ledger.expensive']))
    expect(recorder.plans.map(statement)).toEqual(['select:engine:id,note,amount'])
  })

  test('a projection naming a foreign key narrows it as a bare read does', async () => {
    await seedMembers()

    const rows = await observe('select(orgId, mentorId)', () =>
      database.context(member).db.Member.select('orgId', 'mentorId').orderBy({ id: 'asc' }).all(),
    )

    expect(rows).toEqual([
      { id: 1, orgId: 1, mentorId: null },
      { id: 2, orgId: null, mentorId: null },
      { id: 3, orgId: null, mentorId: null },
    ])
  })
})

describe('the row lock', () => {
  test('forUpdate().first() returns the re-read row through Field Visibility', async () => {
    await seedMembers()

    const row = await observe('forUpdate().first()', () =>
      database.context(member).transaction((tx) =>
        tx.db.Member.where({ id: { equals: 1 } })
          .forUpdate()
          .first(),
      ),
    )

    expect(row).toEqual(ada)
  })
})

describe('write returns', () => {
  test('create returns what first() would', async () => {
    await seedMembers()

    const created = await observe('create', () =>
      database.context(member).db.Member.create({
        data: {
          name: 'dee',
          salary: 1,
          secret: 'x',
          badge: 'b',
          nickname: 'd',
          org: { connect: { id: 1 } },
        },
      }),
    )

    expect(created).toEqual({
      ...ada,
      id: 4,
      name: 'dee',
      nickname: 'D',
      avatar: { filename: null, filesize: null },
      label: 'member dee',
    })
  })

  test('update returns what first() would', async () => {
    await seedMembers()

    const updated = await observe('update', () =>
      database.context(member).db.Member.update({ where: { id: 2 }, data: { nickname: 'bobby' } }),
    )

    expect(updated).toEqual({
      ...ada,
      id: 2,
      name: 'bob',
      nickname: 'BOBBY',
      avatar: { filename: null, filesize: null },
      orgId: null,
      label: 'member bob',
    })
  })

  test('delete returns the row as it stood', async () => {
    await seedMembers()

    const deleted = await observe('delete', () =>
      database.context(member).db.Member.delete({ where: { id: 1 } }),
    )

    expect(deleted).toEqual(ada)
  })

  test('a row the session cannot query comes back as its system fields', async () => {
    const created = await observe('create on a list the session cannot query', () =>
      database.context(member).db.Sealed.create({ data: { name: 'x' } }),
    )

    expect(created).toEqual({ id: 1 })
  })

  test('a list declaring a relation returns the re-read row', async () => {
    const created = await observe('create on a list declaring a relation', async () => {
      const order = await database.context(member).db.Order.create({ data: { ref: 'o' } })
      return order
    })

    expect(created).toEqual({ id: 1, ref: 'o', total: 0 })
  })
})
