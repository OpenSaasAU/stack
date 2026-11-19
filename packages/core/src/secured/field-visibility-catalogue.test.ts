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
import type { CatalogueEntry } from './fixtures/field-visibility-catalogue-entries.js'
import { fieldVisibilityRuns } from './field-visibility.js'

const BOOT = 120_000

type Call = readonly unknown[]

const calls: Call[] = []

function record(...call: unknown[]): void {
  calls.push(call)
}

function keysOf(item: object): string[] {
  return Object.keys(item)
}

function enumerates(session: Session | null): boolean {
  return session?.enumerate === true
}

function ruleKeys(session: Session | null, item: object): string[] | 'not enumerated' {
  return enumerates(session) ? keysOf(item) : 'not enumerated'
}

async function ticks(count: number): Promise<void> {
  for (let tick = 0; tick < count; tick++) await Promise.resolve()
}

function avatar(prefix = 'avatar'): FieldConfig {
  const field = json()
  const columns = [`${prefix}_filename`, `${prefix}_filesize`]
  field.getContractField = () => ({
    kind: 'columns',
    columns: [
      { name: columns[0], type: { pack: 'pg', type: 'text' }, nullable: true },
      { name: columns[1], type: { pack: 'pg', type: 'int' }, nullable: true },
    ],
  })
  field.getColumnNames = () => columns
  field.assembleColumns = (fieldName, row) => {
    record('assembleColumns', fieldName, row.id)
    return { filename: row[columns[0]], filesize: row[columns[1]] }
  }
  field.splitColumns = (_fieldName, value) => {
    const parts: { filename?: unknown; filesize?: unknown } =
      typeof value === 'object' && value !== null ? value : {}
    return { [columns[0]]: parts.filename ?? null, [columns[1]]: parts.filesize ?? null }
  }
  return field
}

function titlesOf(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map((row: unknown) => (isRecord(row) ? row.title : row))
    : (value ?? 'nothing')
}

function mutatedInPlace(field: FieldConfig): FieldConfig {
  field.hooks = {
    resolveOutput: ({ value }) => {
      if (isRecord(value)) value.filename = 'MUTATED'
      return value
    },
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
          query: (args) => {
            record('query', 'Org', keysOf(args))
            return { listed: { equals: true } }
          },
        },
      },
    },
    Mentor: {
      fields: { name: text() },
      access: {
        operation: {
          query: (args) => {
            record('query', 'Mentor', keysOf(args))
            return false
          },
          create: () => true,
        },
      },
    },
    Member: {
      fields: {
        name: text(),
        salary: integer({
          access: {
            read: ({ session, item }) => {
              record('read', 'Member.salary', item.name, ruleKeys(session, item))
              return session?.role === 'admin'
            },
          },
        }),
        secret: text({
          access: {
            read: ({ session, item }) => {
              record('read', 'Member.secret', ruleKeys(session, item))
              return false
            },
          },
        }),
        badge: text({
          access: {
            read: ({ session, item }) => {
              record('read', 'Member.badge', ruleKeys(session, item))
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
            read: ({ session, item }) => {
              record('read', 'Member.org', ruleKeys(session, item))
              return session !== null
            },
          },
        }),
        mentor: relationship({ ref: 'Mentor' }),
      },
      access: {
        operation: {
          query: (args) => {
            record('query', 'Member', keysOf(args))
            return true
          },
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
            read: ({ session, item }) => {
              record('read', 'Ledger.note', ruleKeys(session, item))
              return session?.role !== undefined
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
      access: {
        operation: {
          query: (args) => {
            record('query', 'Ledger', keysOf(args))
            return true
          },
        },
      },
    },
    Sealed: {
      fields: { name: text() },
      access: {
        operation: {
          query: (args) => {
            record('query', 'Sealed', keysOf(args))
            return false
          },
          create: () => true,
        },
      },
    },
    Order: {
      fields: {
        ref: text({
          access: {
            read: ({ session, item }) => {
              record('read', 'Order.ref', ruleKeys(session, item))
              return session?.role === 'admin'
            },
          },
        }),
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
      access: {
        operation: {
          query: (args) => {
            record('query', 'Order', keysOf(args))
            return true
          },
          create: () => true,
        },
      },
    },
    Line: {
      fields: { price: integer(), order: relationship({ ref: 'Order.lines' }) },
      access: {
        operation: {
          query: (args) => {
            record('query', 'Line', keysOf(args))
            return true
          },
          create: () => true,
        },
      },
    },
    Region: {
      fields: {
        name: text(),
        code: text({
          access: {
            read: ({ session, item }) => {
              record('read', 'Region.code', item.name, ruleKeys(session, item))
              return item.name !== 'r2'
            },
          },
        }),
        teams: relationship({
          ref: 'Team.region',
          many: true,
          access: {
            read: ({ item }) => {
              record('read', 'Region.teams', item.name)
              return true
            },
          },
        }),
      },
      access: {
        operation: {
          query: (args) => {
            record('query', 'Region', keysOf(args))
            return true
          },
        },
      },
    },
    Team: {
      fields: {
        name: text(),
        hidden: checkbox(),
        motto: text({
          access: {
            read: async ({ item }) => {
              await ticks((6 - Number(String(item.name).slice(1))) * 3)
              record('read', 'Team.motto', item.name)
              return item.name !== 't2'
            },
          },
        }),
        region: relationship({ ref: 'Region.teams' }),
        players: relationship({ ref: 'Player.team', many: true }),
      },
      access: {
        operation: {
          query: (args) => {
            record('query', 'Team', keysOf(args))
            return { hidden: { equals: false } }
          },
        },
      },
    },
    Coach: {
      fields: { name: text(), listed: checkbox() },
      access: {
        operation: {
          query: (args) => {
            record('query', 'Coach', keysOf(args))
            return { listed: { equals: true } }
          },
        },
      },
    },
    Player: {
      fields: {
        name: text(),
        rating: integer({
          access: {
            read: ({ session, item }) => {
              record('read', 'Player.rating', item.name)
              return session?.role === 'admin'
            },
          },
        }),
        nick: text({
          hooks: {
            resolveOutput: async ({ value }) => {
              await ticks(typeof value === 'string' ? value.length * 2 - 3 : 0)
              record('resolveOutput', 'Player.nick', value)
              return typeof value === 'string' ? value.toUpperCase() : value
            },
          },
        }),
        card: avatar('card'),
        team: relationship({ ref: 'Team.players' }),
        coach: relationship({
          ref: 'Coach',
          access: {
            read: ({ item }) => {
              record('read', 'Player.coach', item.name)
              return item.name !== 'p3'
            },
          },
        }),
        awards: relationship({ ref: 'Award.player', many: true }),
      },
      access: {
        operation: {
          query: (args) => {
            record('query', 'Player', keysOf(args))
            return true
          },
        },
      },
    },
    Sponsor: {
      fields: { name: text(), listed: checkbox() },
      access: {
        operation: {
          query: (args) => {
            record('query', 'Sponsor', keysOf(args))
            return { listed: { equals: true } }
          },
        },
      },
    },
    Award: {
      fields: {
        title: text({
          access: {
            read: ({ item }) => {
              record('read', 'Award.title', item.title)
              return item.player !== null
            },
          },
        }),
        points: integer(),
        player: relationship({ ref: 'Player.awards' }),
        sponsor: relationship({ ref: 'Sponsor', db: { isNullable: false } }),
        worth: virtual({
          type: 'number',
          needs: ['points', 'sponsor'],
          hooks: {
            resolveOutput: ({ item }) => {
              const sponsor: unknown = item.sponsor
              const sponsorName = isRecord(sponsor) ? sponsor.name : sponsor
              record('resolveOutput', 'Award.worth', keysOf(item), sponsorName)
              return Number(item.points) * (sponsorName === null ? 1 : 2)
            },
          },
        }),
      },
      access: {
        operation: {
          query: (args) => {
            record('query', 'Award', keysOf(args))
            return true
          },
        },
      },
    },
    Kit: {
      fields: {
        name: text(),
        asset: mutatedInPlace(avatar('asset')),
        coach: relationship({
          ref: 'Coach',
          access: {
            read: ({ item }) => {
              const asset: unknown = item.asset
              const filename = isRecord(asset) ? asset.filename : asset
              record('read', 'Kit.coach', item.name, filename)
              return filename === `${String(item.name)}.png`
            },
          },
        }),
      },
      access: {
        operation: {
          query: (args) => {
            record('query', 'Kit', keysOf(args))
            return true
          },
        },
      },
    },
    Shelf: {
      fields: {
        name: text(),
        books: relationship({ ref: 'Book.shelf', many: true }),
        keeper: relationship({
          ref: 'Coach',
          access: {
            read: ({ item }) => {
              const titles = titlesOf(item.books)
              record('read', 'Shelf.keeper', item.name, titles)
              return !(Array.isArray(titles) && titles.includes('INJECTED'))
            },
          },
        }),
        weight: virtual({
          type: 'number',
          needs: ['books'],
          hooks: {
            resolveOutput: ({ item, context }) => {
              const books: unknown = item.books
              record('resolveOutput', 'Shelf.weight', keysOf(item), titlesOf(books))
              if (!Array.isArray(books)) return -1
              const visible = books.length
              if (context.session?.mutate === true) {
                books.push({ id: 0, title: 'INJECTED', pages: 0 })
              }
              return visible
            },
          },
        }),
      },
      access: {
        operation: {
          query: (args) => {
            record('query', 'Shelf', keysOf(args))
            return true
          },
          update: () => true,
          delete: () => true,
        },
      },
    },
    Book: {
      fields: {
        title: text({
          access: {
            read: ({ item }) => {
              record('read', 'Book.title', item.title)
              return item.title !== 'b2'
            },
          },
        }),
        pages: integer(),
        hidden: checkbox(),
        shelf: relationship({ ref: 'Shelf.books' }),
        blurb: virtual({
          type: 'string',
          needs: ['pages'],
          hooks: {
            resolveOutput: ({ item }) => {
              record('resolveOutput', 'Book.blurb', keysOf(item), item.pages)
              return `${String(item.pages)}p`
            },
          },
        }),
      },
      access: {
        operation: {
          query: (args) => {
            record('query', 'Book', keysOf(args))
            return { hidden: { equals: false } }
          },
        },
      },
    },
    Node: {
      fields: {
        label: text({
          hooks: {
            resolveOutput: ({ value }) => {
              record('resolveOutput', 'Node.label', value)
              return `resolved:${String(value)}`
            },
          },
        }),
        secret: text({
          access: {
            read: ({ item }) => {
              record('read', 'Node.secret', item.label)
              return false
            },
          },
        }),
        next: relationship({ ref: 'Node' }),
      },
      access: {
        operation: {
          query: (args) => {
            record('query', 'Node', keysOf(args))
            return true
          },
        },
      },
    },
  },
}

const recorder = createPlanRecorder()
let database: TestDatabase

const member: Session = { role: 'member' }
const admin: Session = { role: 'admin' }
const enumerating: Session = { role: 'admin', enumerate: true }

interface Statement {
  readonly shape: string
  readonly ast: unknown
}

interface Observation {
  readonly result: unknown
  readonly calls: readonly Call[]
  readonly statements: readonly Statement[]
}

const observations: Partial<Record<CatalogueEntry, Observation>> = {}

/** Which implementation an entry's reads reach under `=new`: the walks run every read under `=old`. */
type Implementation = 'traversal' | 'walks' | 'none'

const traversing = process.env.OPENSAAS_FIELD_VISIBILITY === 'new'

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

function plainAst(plan: RecordedPlan): unknown {
  return JSON.parse(
    JSON.stringify(plan.ast, (_key, value: unknown) =>
      typeof value === 'bigint' ? `${value}n` : value,
    ),
  )
}

function callsTo(kind: string, label: string): Call[] {
  return calls.filter((call) => call[0] === kind && call[1] === label)
}

function ruleAndHookCalls(): Call[] {
  return calls.filter((call) => call[0] === 'read' || call[0] === 'resolveOutput')
}

function hookItems(label: string): unknown[] {
  return callsTo('resolveOutput', label).map((call) => call[2])
}

const memberColumns = [
  'id',
  'name',
  'salary',
  'secret',
  'badge',
  'nickname',
  'orgId',
  'mentorId',
  'avatar',
]

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
async function observe(
  name: CatalogueEntry,
  ran: Implementation,
  run: () => Promise<unknown>,
): Promise<unknown> {
  if (name in observations) throw new Error(`catalogue entry "${name}" is observed twice`)
  calls.length = 0
  recorder.clear()
  const before = fieldVisibilityRuns()
  const result = await run()
  const after = fieldVisibilityRuns()
  expect(
    {
      walks: after.walks - before.walks > 0,
      traversal: after.traversal - before.traversal > 0,
    },
    `the implementation that ran "${name}"`,
  ).toEqual({
    walks: ran === 'walks' || (ran === 'traversal' && !traversing),
    traversal: ran === 'traversal' && traversing,
  })
  observations[name] = {
    result: JSON.parse(JSON.stringify(result ?? null)),
    calls: calls.map((call) => [...call]),
    statements: recorder.plans.map((plan) => ({ shape: statement(plan), ast: plainAst(plan) })),
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

    const rows = await observe('bare all() as a member', 'traversal', () =>
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
    expect(hookItems('Member.nickname')).toEqual([['id'], ['id'], ['id']])
    expect(hookItems('Member.label')).toEqual([
      ['id', 'name'],
      ['id', 'name'],
      ['id', 'name'],
    ])
  })

  test('all() as an admin reads the salary its rule grants', async () => {
    await seedMembers()

    const rows = await observe('bare all() as an admin', 'traversal', () =>
      database
        .context(admin)
        .db.Member.where({ name: { equals: 'ada' } })
        .all(),
    )

    expect(rows).toEqual([{ ...ada, salary: 100 }])
    expect(callsTo('read', 'Member.salary')).toEqual([
      ['read', 'Member.salary', 'ada', 'not enumerated'],
    ])
  })

  test('first() anonymously nulls a foreign key whose field rule denies', async () => {
    await seedMembers()

    const row = await observe('bare first() anonymously', 'traversal', () =>
      database.context(null).db.Member.orderBy({ id: 'asc' }).first(),
    )

    expect(row).toEqual({ ...ada, orgId: null })
  })

  test('a sudo read skips every rule and the foreign-key pass', async () => {
    await seedMembers()

    const row = await observe('bare first() under sudo', 'traversal', () =>
      database.context(null).sudo().db.Member.orderBy({ id: 'asc' }).first(),
    )

    expect(row).toEqual({ ...ada, salary: 100, secret: 's1', badge: 'gold', mentorId: 1 })
    expect(calls.filter((call) => call[0] === 'read' || call[0] === 'query')).toEqual([])
    expect(recorder.plans.map(statement)).toEqual([
      'select:engine:id,name,salary,secret,badge,nickname,avatar_filename,avatar_filesize,orgId,mentorId',
    ])
  })

  test('a list with no relations computes every computed field from its declared set', async () => {
    await seedLedger()

    const rows = await observe('bare all() on a list with no relations', 'traversal', () =>
      database.context({ enumerate: true }).db.Ledger.all(),
    )

    expect(rows).toEqual([{ id: 1, amount: 3, secretSauce: 41, total: 6, expensive: 42 }])
    expect(ruleAndHookCalls()).toEqual([
      ['read', 'Ledger.note', ['id', 'amount', 'secretSauce', 'note']],
      ['resolveOutput', 'Ledger.total', ['id', 'amount']],
      ['resolveOutput', 'Ledger.expensive', ['id', 'secretSauce']],
    ])
  })

  test('a rule enumerating its row sees the stored columns, and denies while a relation is withheld', async () => {
    await seedMembers()

    const rows = await observe('a rule enumerating its row', 'traversal', () =>
      database
        .context(enumerating)
        .db.Member.where({ name: { equals: 'ada' } })
        .all(),
    )

    expect(rows).toEqual([{ ...ada, orgId: null }])
    expect(ruleAndHookCalls()).toEqual([
      ['read', 'Member.salary', 'ada', memberColumns],
      ['read', 'Member.secret', memberColumns],
      ['read', 'Member.badge', memberColumns],
      ['resolveOutput', 'Member.nickname', ['id']],
      ['resolveOutput', 'Member.label', ['id', 'name']],
      ['read', 'Member.org', memberColumns],
    ])
  })
})

describe('projections', () => {
  test('a projection runs only the rules and hooks of the fields it names', async () => {
    await seedMembers()

    const rows = await observe('select(name, label)', 'traversal', () =>
      database
        .context(member)
        .db.Member.select('name', 'label')
        .orderBy({ id: 'asc' })
        .limit(1)
        .all(),
    )

    expect(rows).toEqual([{ id: 1, name: 'ada', label: 'member ada' }])
    expect(ruleAndHookCalls()).toEqual([['resolveOutput', 'Member.label', ['id', 'name']]])
    expect(recorder.plans.map(statement)).toEqual(['select:engine:id,name'])
  })

  test('an unselected computed field neither runs nor widens the fetch', async () => {
    await seedLedger()

    const rows = await observe('select(note, total) leaves expensive alone', 'traversal', () =>
      database.context(member).db.Ledger.select('note', 'total').all(),
    )

    expect(rows).toEqual([{ id: 1, note: 'n', total: 6 }])
    expect(calls).not.toContainEqual(expect.arrayContaining(['Ledger.expensive']))
    expect(callsTo('read', 'Ledger.note')).not.toEqual([])
    expect(hookItems('Ledger.total')).toEqual([['id', 'amount']])
    expect(recorder.plans.map(statement)).toEqual(['select:engine:id,note,amount'])
  })

  test('a projection naming a foreign key narrows it as a bare read does', async () => {
    await seedMembers()

    const rows = await observe('select(orgId, mentorId)', 'traversal', () =>
      database.context(member).db.Member.select('orgId', 'mentorId').orderBy({ id: 'asc' }).all(),
    )

    expect(rows).toEqual([
      { id: 1, orgId: 1, mentorId: null },
      { id: 2, orgId: null, mentorId: null },
      { id: 3, orgId: null, mentorId: null },
    ])
    expect(callsTo('read', 'Member.org')).not.toEqual([])
  })
})

describe('the row lock', () => {
  test('forUpdate().first() returns the re-read row through Field Visibility', async () => {
    await seedMembers()

    const row = await observe('forUpdate().first()', 'traversal', () =>
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

    const created = await observe('create', 'traversal', () =>
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

    const updated = await observe('update', 'traversal', () =>
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

    const deleted = await observe('delete', 'traversal', () =>
      database.context(member).db.Member.delete({ where: { id: 1 } }),
    )

    expect(deleted).toEqual(ada)
  })

  test('a row the session cannot query comes back as its system fields', async () => {
    const created = await observe('create on a list the session cannot query', 'none', () =>
      database.context(member).db.Sealed.create({ data: { name: 'x' } }),
    )

    expect(created).toEqual({ id: 1 })
  })

  test('a list declaring a relation returns the re-read row through its rules', async () => {
    const created = await observe('create on a list declaring a relation', 'traversal', () =>
      database.context(member).db.Order.create({ data: { ref: 'o' } }),
    )

    expect(created).toEqual({ id: 1, total: 0 })
    expect(ruleAndHookCalls()).toEqual([
      ['read', 'Order.ref', 'not enumerated'],
      ['resolveOutput', 'Order.total', ['id', 'lines']],
    ])
  })
})

/**
 * Regions r1–r3; teams t1–t4 two per region in r1 and r2, and t5 in r3, hidden;
 * players p1–p8 two per visible team, coached by the listed c1 when odd and
 * the unlisted c2 when even; awards a1–a16 two per player, sponsored by the
 * listed s1 when odd and the unlisted s2 when even.
 */
async function seedLeague(): Promise<void> {
  const sudo = database.context(null).sudo().db
  for (const name of ['r1', 'r2', 'r3'])
    await sudo.Region.create({ data: { name, code: `${name}!` } })
  for (let team = 1; team <= 5; team++) {
    await sudo.Team.create({
      data: {
        name: `t${team}`,
        hidden: team === 5,
        motto: `m${team}`,
        region: { connect: { id: Math.ceil(team / 2) } },
      },
    })
  }
  await sudo.Coach.create({ data: { name: 'c1', listed: true } })
  await sudo.Coach.create({ data: { name: 'c2', listed: false } })
  await sudo.Sponsor.create({ data: { name: 's1', listed: true } })
  await sudo.Sponsor.create({ data: { name: 's2', listed: false } })
  for (let player = 1; player <= 8; player++) {
    await sudo.Player.create({
      data: {
        name: `p${player}`,
        rating: player * 10,
        nick: `n${player}`,
        card: { filename: `p${player}.png`, filesize: player },
        team: { connect: { id: Math.ceil(player / 2) } },
        coach: { connect: { id: player % 2 === 1 ? 1 : 2 } },
      },
    })
  }
  for (let award = 1; award <= 16; award++) {
    await sudo.Award.create({
      data: {
        title: `a${award}`,
        points: award,
        player: { connect: { id: Math.ceil(award / 2) } },
        sponsor: { connect: { id: award % 2 === 1 ? 1 : 2 } },
      },
    })
  }
}

function shownAward(award: number): Record<string, unknown> {
  const listed = award % 2 === 1
  return {
    id: award,
    points: award,
    playerId: Math.ceil(award / 2),
    sponsorId: listed ? 1 : null,
    worth: award * (listed ? 2 : 1),
  }
}

function shownPlayer(player: number): Record<string, unknown> {
  return {
    id: player,
    name: `p${player}`,
    nick: `N${player}`,
    card: { filename: `p${player}.png`, filesize: player },
    teamId: Math.ceil(player / 2),
    coachId: player % 2 === 1 && player !== 3 ? 1 : null,
    awards: [player * 2 - 1, player * 2].map(shownAward),
  }
}

function shownTeam(team: number): Record<string, unknown> {
  return {
    id: team,
    name: `t${team}`,
    hidden: false,
    ...(team === 2 ? {} : { motto: `m${team}` }),
    regionId: Math.ceil(team / 2),
    players: [team * 2 - 1, team * 2].map(shownPlayer),
  }
}

/** Each rule and hook call as its label and the row it ran on, in the order they ran. */
function ruleAndHookOrder(): string[] {
  return ruleAndHookCalls().map(
    (call) => `${String(call[1])} ${String(call[1] === 'Award.worth' ? call[3] : call[2])}`,
  )
}

function assembledIds(): unknown[] {
  return calls.filter((call) => call[0] === 'assembleColumns').map((call) => call[2])
}

const league = [
  { id: 1, name: 'r1', code: 'r1!', teams: [1, 2].map(shownTeam) },
  { id: 2, name: 'r2', teams: [3, 4].map(shownTeam) },
  { id: 3, name: 'r3', code: 'r3!', teams: [] },
]

describe('includes', () => {
  test('three levels of includes over several rows strip, compute and narrow at every node', async () => {
    await seedLeague()

    const rows = await observe('nested includes three deep across several rows', 'traversal', () =>
      database
        .context(member)
        .db.Region.orderBy({ id: 'asc' })
        .include('teams', (teams) =>
          teams.include('players', (players) => players.include('awards')),
        )
        .all(),
    )

    expect(rows).toEqual(league)
    expect(ruleAndHookOrder()).toEqual([
      'Region.code r1',
      'Region.code r2',
      'Region.code r3',
      'Region.teams r1',
      'Region.teams r2',
      'Region.teams r3',
      'Team.motto t4',
      'Team.motto t3',
      'Team.motto t2',
      'Team.motto t1',
      'Player.rating p7',
      'Player.rating p8',
      'Player.rating p5',
      'Player.rating p6',
      'Player.rating p3',
      'Player.rating p4',
      'Player.nick n7',
      'Player.nick n8',
      'Player.rating p1',
      'Player.rating p2',
      'Player.nick n5',
      'Player.nick n6',
      'Player.nick n3',
      'Player.nick n4',
      'Award.title a13',
      'Award.title a14',
      'Award.title a15',
      'Award.title a16',
      'Player.nick n1',
      'Player.nick n2',
      'Award.title a9',
      'Award.title a10',
      'Award.title a11',
      'Award.title a12',
      'Award.title a5',
      'Award.title a6',
      'Award.title a7',
      'Award.title a8',
      'Award.title a1',
      'Award.title a2',
      'Award.title a3',
      'Award.title a4',
      'Award.worth s1',
      'Award.worth s1',
      'Award.worth null',
      'Award.worth null',
      'Award.worth s1',
      'Award.worth s1',
      'Award.worth null',
      'Award.worth null',
      'Award.worth s1',
      'Award.worth s1',
      'Award.worth null',
      'Award.worth null',
      'Award.worth s1',
      'Award.worth s1',
      'Award.worth null',
      'Award.worth null',
      'Player.coach p1',
      'Player.coach p2',
      'Player.coach p3',
      'Player.coach p4',
      'Player.coach p5',
      'Player.coach p6',
      'Player.coach p7',
      'Player.coach p8',
    ])
    expect(callsTo('read', 'Player.rating')).toHaveLength(8)
    expect(callsTo('read', 'Award.title')).toHaveLength(16)
    expect(hookItems('Award.worth')).toEqual(
      Array(16).fill(['id', 'points', 'sponsorId', 'sponsor']),
    )
    expect(calls.filter((call) => call[0] === 'query').map((call) => call[1])).toEqual([
      'Region',
      'Sponsor',
      'Award',
      'Player',
      'Team',
      'Region',
      'Team',
      'Coach',
      'Player',
      'Sponsor',
    ])
    expect(recorder.plans.map(statement)).toEqual([
      expect.stringMatching(/^select:engine:/),
      'select:engine:id',
      'select:engine:id',
      'select:engine:id',
    ])
  })

  test('a multi-column field reads assembled under its own key, its part columns never shown', async () => {
    await seedLeague()

    const rows = await observe('a multi-column field reads assembled', 'traversal', () =>
      database
        .context(member)
        .db.Team.where({ id: { equals: 1 } })
        .include('players')
        .all(),
    )

    const players = [1, 2].map((id) => {
      const { awards: _awards, ...player } = shownPlayer(id)
      return player
    })
    expect(rows).toEqual([{ ...shownTeam(1), players }])
    expect(assembledIds()).toEqual([1, 2, 1, 2])
  })

  test("a foreign-key owner's rule never sees a hook's in-place change to an assembled value", async () => {
    await seedLeague()
    const sudo = database.context(null).sudo().db
    for (const kit of [1, 2]) {
      await sudo.Kit.create({
        data: {
          name: `k${kit}`,
          asset: { filename: `k${kit}.png`, filesize: kit },
          coach: { connect: { id: 1 } },
        },
      })
    }

    const rows = await observe('a hook mutating an assembled value in place', 'traversal', () =>
      database.context(member).db.Kit.orderBy({ id: 'asc' }).all(),
    )

    expect(rows).toEqual(
      [1, 2].map((kit) => ({
        id: kit,
        name: `k${kit}`,
        asset: { filename: 'MUTATED', filesize: kit },
        coachId: 1,
      })),
    )
    expect(callsTo('read', 'Kit.coach')).toEqual([
      ['read', 'Kit.coach', 'k1', 'k1.png'],
      ['read', 'Kit.coach', 'k2', 'k2.png'],
    ])
  })

  test('one multi-column row reached through two paths is assembled and narrowed on each', async () => {
    await seedLeague()

    const rows = await observe('one multi-column row reached through two paths', 'traversal', () =>
      database
        .context(member)
        .db.Team.where({ id: { equals: 1 } })
        .include('players', (players) =>
          players.include('awards', (awards) => awards.include('player')),
        )
        .all(),
    )

    const bare = (id: number) => {
      const { awards: _awards, ...player } = shownPlayer(id)
      return player
    }
    const players = [1, 2].map((id) => ({
      ...bare(id),
      awards: [id * 2 - 1, id * 2].map((award) => ({
        ...shownAward(award),
        title: `a${award}`,
        player: bare(id),
      })),
    }))
    expect(rows).toEqual([{ ...shownTeam(1), players }])
    expect(assembledIds()).toEqual([1, 2, 1, 1, 2, 2, 1, 2, 1, 1, 2, 2])
    expect(callsTo('read', 'Player.coach').map((call) => call[2])).toEqual([
      'p1',
      'p2',
      'p1',
      'p1',
      'p2',
      'p2',
    ])
  })

  test('a declared dependency the caller did not name reaches its hook and never the caller', async () => {
    await seedLeague()

    const rows = await observe('a declared dependency the caller did not name', 'traversal', () =>
      database
        .context(member)
        .db.Award.where({ id: { in: [1, 2] } })
        .orderBy({ id: 'asc' })
        .all(),
    )

    expect(rows).toEqual([shownAward(1), shownAward(2)])
    expect(callsTo('resolveOutput', 'Award.worth')).toEqual([
      ['resolveOutput', 'Award.worth', ['id', 'points', 'sponsorId', 'sponsor'], 's1'],
      ['resolveOutput', 'Award.worth', ['id', 'points', 'sponsorId', 'sponsor'], null],
    ])
  })

  test('a to-one scoped away reads null by arity, nullable or not, and a to-many reads []', async () => {
    await seedLeague()

    const read = await observe('a to-one scoped away reads null', 'traversal', async () => ({
      awards: await database
        .context(member)
        .db.Award.where({ id: { in: [1, 4, 5, 8] } })
        .orderBy({ id: 'asc' })
        .include('sponsor')
        .include('player', (player) => player.include('coach'))
        .all(),
      regions: await database
        .context(member)
        .db.Region.where({ id: { equals: 3 } })
        .include('teams')
        .all(),
    }))

    const sponsor = { id: 1, name: 's1', listed: true }
    const player = (id: number) => {
      const { awards: _awards, coachId, ...rest } = shownPlayer(id)
      if (id === 3) return { ...rest, coachId }
      return {
        ...rest,
        coachId,
        coach: coachId === null ? null : { id: 1, name: 'c1', listed: true },
      }
    }
    expect(read).toEqual({
      awards: [
        { ...shownAward(1), sponsor, player: player(1) },
        { ...shownAward(4), sponsor: null, player: player(2) },
        { ...shownAward(5), sponsor, player: player(3) },
        { ...shownAward(8), sponsor: null, player: player(4) },
      ],
      regions: [{ id: 3, name: 'r3', code: 'r3!', teams: [] }],
    })
    expect(
      callsTo('resolveOutput', 'Award.worth')
        .map((call) => String(call[3]))
        .sort(),
    ).toEqual(['null', 'null', 's1', 's1'])
  })

  test('a nested rule reaching for a relation its row does not carry denies', async () => {
    await seedLeague()

    const rows = await observe('a nested rule reaching for a withheld relation', 'traversal', () =>
      database
        .context(member)
        .db.Player.where({ id: { equals: 1 } })
        .include('awards')
        .all(),
    )

    const { awards: _awards, ...player } = shownPlayer(1)
    expect(rows).toEqual([{ ...player, awards: [shownAward(1), shownAward(2)] }])
    expect(callsTo('read', 'Award.title')).toEqual([
      ['read', 'Award.title', 'a1'],
      ['read', 'Award.title', 'a2'],
    ])
  })

  test('a Synthetic back-relation keeps the rows its source field lets the session read', async () => {
    await seedLeague()

    const rows = await observe('a Synthetic back-relation', 'traversal', () =>
      database
        .context(member)
        .db.Coach.include('from_Player_coach', (players) => players.include('awards'))
        .all(),
    )

    expect(rows).toEqual([
      { id: 1, name: 'c1', listed: true, from_Player_coach: [1, 5, 7].map(shownPlayer) },
    ])
    expect(
      callsTo('read', 'Player.coach')
        .slice(0, 4)
        .map((call) => call[2]),
    ).toEqual(['p1', 'p3', 'p5', 'p7'])
  })

  test('a read at the include depth cap strips and computes on the deepest level', async () => {
    const sudo = database.context(null).sudo().db
    for (let node = 6; node >= 1; node--) {
      await sudo.Node.create({
        data: {
          label: `n${node}`,
          secret: `s${node}`,
          ...(node < 6 ? { next: { connect: { id: 7 - node - 1 } } } : {}),
        },
      })
    }

    const rows = await observe('an include at the depth cap', 'traversal', () =>
      database
        .context(member)
        .db.Node.where({ label: { equals: 'n1' } })
        .include('next', (n2) =>
          n2.include('next', (n3) =>
            n3.include('next', (n4) => n4.include('next', (n5) => n5.include('next'))),
          ),
        )
        .all(),
    )

    const chain = (node: number): Record<string, unknown> => ({
      id: 7 - node,
      label: `resolved:n${node}`,
      nextId: node < 6 ? 7 - node - 1 : null,
      ...(node < 6 ? { next: chain(node + 1) } : {}),
    })
    expect(rows).toEqual([chain(1)])
    expect(callsTo('read', 'Node.secret').map((call) => call[2])).toEqual([
      'n1',
      'n2',
      'n3',
      'n4',
      'n5',
      'n6',
    ])
  })
})

describe('reductions', () => {
  test('a count reads as a number, and a denied relation keeps no key', async () => {
    await seedLeague()

    const rows = await observe('a count reads as a number', 'traversal', () =>
      database
        .context(member)
        .db.Region.orderBy({ id: 'asc' })
        .include('teams', (teams) => teams.count())
        .all(),
    )

    expect(rows).toEqual([
      { id: 1, name: 'r1', code: 'r1!', teams: 2 },
      { id: 2, name: 'r2', teams: 2 },
      { id: 3, name: 'r3', code: 'r3!', teams: 0 },
    ])
    expect(callsTo('read', 'Region.teams').map((call) => call[2])).toEqual(['r1', 'r2', 'r3'])
  })

  test('a combine of counts reads as its counts', async () => {
    await seedLeague()

    const rows = await observe('a combine of counts', 'traversal', () =>
      database
        .context(member)
        .db.Region.orderBy({ id: 'asc' })
        .include('teams', (teams) =>
          teams.combine({
            all: teams.count(),
            first: teams.where({ name: { equals: 't1' } }).count(),
          }),
        )
        .all(),
    )

    expect(rows).toEqual([
      { id: 1, name: 'r1', code: 'r1!', teams: { all: 2, first: 1 } },
      { id: 2, name: 'r2', teams: { all: 2, first: 0 } },
      { id: 3, name: 'r3', code: 'r3!', teams: { all: 0, first: 0 } },
    ])
  })

  test('a combine rows branch strips, computes and narrows its rows, and counts beneath them', async () => {
    await seedLeague()

    const rows = await observe(
      'a combine with a rows branch, nested includes and a nested count',
      'traversal',
      () =>
        database
          .context(member)
          .db.Region.where({ id: { in: [1, 3] } })
          .orderBy({ id: 'asc' })
          .include('teams', (teams) =>
            teams.combine({
              total: teams.count(),
              rows: teams.orderBy({ id: 'desc' }).include('players', (players) =>
                players.combine({
                  n: players.count(),
                  top: players
                    .orderBy({ id: 'asc' })
                    .limit(1)
                    .include('awards', (awards) => awards.count()),
                }),
              ),
            }),
          )
          .all(),
    )

    const player = (id: number) => {
      const { awards: _awards, ...rest } = shownPlayer(id)
      return { ...rest, awards: 2 }
    }
    const team = (id: number) => {
      const { players: _players, ...rest } = shownTeam(id)
      return { ...rest, players: { n: 2, top: [player(id * 2 - 1)] } }
    }
    expect(rows).toEqual([
      { id: 1, name: 'r1', code: 'r1!', teams: { total: 2, rows: [team(2), team(1)] } },
      { id: 3, name: 'r3', code: 'r3!', teams: { total: 0, rows: [] } },
    ])
    expect(callsTo('read', 'Team.motto').map((call) => call[2])).toEqual(['t2', 't1'])
    expect(callsTo('read', 'Player.coach').map((call) => call[2])).toEqual(['p3', 'p1'])
  })
})

/**
 * Shelves sh1 and sh3 kept by the listed coach c1, sh2 by the unlisted c2;
 * books b1 (120 pages), b2 (80) and the hidden b3 (200) on sh1, and b4 (150)
 * on sh2.
 */
async function seedShelves(withCoaches = true): Promise<void> {
  const sudo = database.context(null).sudo().db
  if (withCoaches) {
    await sudo.Coach.create({ data: { name: 'c1', listed: true } })
    await sudo.Coach.create({ data: { name: 'c2', listed: false } })
  }
  for (const [name, keeper] of [
    ['sh1', 1],
    ['sh2', 2],
    ['sh3', 1],
  ] as const) {
    await sudo.Shelf.create({ data: { name, keeper: { connect: { id: keeper } } } })
  }
  for (const [title, pages, hidden, shelf] of [
    ['b1', 120, false, 1],
    ['b2', 80, false, 1],
    ['b3', 200, true, 1],
    ['b4', 150, false, 2],
  ] as const) {
    await sudo.Book.create({ data: { title, pages, hidden, shelf: { connect: { id: shelf } } } })
  }
}

const mutating: Session = { role: 'member', mutate: true }

function shelf(id: number, books: unknown, weight: number): Record<string, unknown> {
  return {
    id,
    name: `sh${id}`,
    keeperId: id === 2 ? null : 1,
    ...(books === undefined ? {} : { books }),
    weight,
  }
}

function book(id: number): Record<string, unknown> {
  const pages = [120, 80, 200, 150][id - 1]
  return {
    id,
    ...(id === 2 ? {} : { title: `b${id}` }),
    pages,
    hidden: false,
    shelfId: id === 4 ? 2 : 1,
    blurb: `${pages}p`,
  }
}

/** The pages of each book `Book.blurb` computed on, in the order it ran. */
function blurbed(): unknown[] {
  return callsTo('resolveOutput', 'Book.blurb').map((call) => call[3])
}

function weighed(): unknown[] {
  return callsTo('resolveOutput', 'Shelf.weight').map((call) => call[3])
}

describe('declared relations a caller reduces or shapes', () => {
  test('a count over a declared relation hands the hook the declared rows and computes nothing on them', async () => {
    await seedShelves()

    const rows = await observe('a count standing in for a declared relation', 'traversal', () =>
      database
        .context(member)
        .db.Shelf.orderBy({ id: 'asc' })
        .include('books', (books) => books.count())
        .all(),
    )

    expect(rows).toEqual([shelf(1, 2, 2), shelf(2, 1, 1), shelf(3, 0, 0)])
    expect(callsTo('resolveOutput', 'Shelf.weight')).toEqual([
      ['resolveOutput', 'Shelf.weight', ['id', 'books'], ['b1', 'b2']],
      ['resolveOutput', 'Shelf.weight', ['id', 'books'], ['b4']],
      ['resolveOutput', 'Shelf.weight', ['id', 'books'], []],
    ])
    expect(blurbed()).toEqual([])
    expect(callsTo('read', 'Book.title')).toEqual([])
  })

  test('a combine rows branch beside a declared relation hands the hook the unshaped rows', async () => {
    await seedShelves()

    const rows = await observe(
      'a combine rows branch beside a declared relation',
      'traversal',
      () =>
        database
          .context(member)
          .db.Shelf.where({ id: { in: [1, 2] } })
          .orderBy({ id: 'asc' })
          .include('books', (books) =>
            books.combine({ total: books.count(), top: books.orderBy({ pages: 'desc' }).limit(1) }),
          )
          .all(),
    )

    expect(rows).toEqual([
      shelf(1, { total: 2, top: [book(1)] }, 2),
      shelf(2, { total: 1, top: [book(4)] }, 1),
    ])
    expect(hookItems('Shelf.weight')).toEqual([
      ['id', 'books'],
      ['id', 'books'],
    ])
    expect(weighed()).toEqual([['b1', 'b2'], ['b4']])
    expect(blurbed()).toEqual([120, 150])
  })

  test('a caller-shaped declared to-one hands the hook the unshaped row', async () => {
    await seedLeague()

    const rows = await observe('a caller-shaped declared to-one', 'traversal', () =>
      database
        .context(member)
        .db.Award.where({ id: { in: [1, 2] } })
        .orderBy({ id: 'asc' })
        .include('sponsor', (sponsor) => sponsor.where({ name: { equals: 'nobody' } }))
        .all(),
    )

    expect(rows).toEqual([
      { ...shownAward(1), sponsor: null },
      { ...shownAward(2), sponsor: null },
    ])
    expect(callsTo('resolveOutput', 'Award.worth').map((call) => call[3])).toEqual(['s1', null])
  })

  test('a caller-shaped declared to-many returns the shaped rows and hands the hook the unshaped ones', async () => {
    await seedShelves()

    const rows = await observe('a caller-shaped declared to-many', 'traversal', () =>
      database
        .context(member)
        .db.Shelf.orderBy({ id: 'asc' })
        .include('books', (books) => books.where({ pages: { gt: 100 } }))
        .all(),
    )

    expect(rows).toEqual([shelf(1, [book(1)], 2), shelf(2, [book(4)], 1), shelf(3, [], 0)])
    expect(weighed()).toEqual([[], ['b1', 'b2'], ['b4']])
    expect(blurbed()).toEqual([120, 150])
    expect(recorder.plans.map(statement)).toEqual([
      expect.stringMatching(/^select:engine:/),
      expect.stringMatching(/^select:engine:id,books/),
      'select:engine:id',
    ])
  })

  test('a caller-shaped declared relation inside a transaction fetches its unshaped rows there', async () => {
    await seedShelves()

    const rows = await observe(
      'a caller-shaped declared relation inside a transaction',
      'traversal',
      () =>
        database.context(member).transaction((tx) =>
          tx.db.Shelf.where({ id: { equals: 1 } })
            .include('books', (books) => books.where({ pages: { lt: 100 } }))
            .all(),
        ),
    )

    expect(rows).toEqual([shelf(1, [book(2)], 2)])
    expect(weighed()).toEqual([['b1', 'b2']])
    expect(blurbed()).toEqual([80])
  })

  test('a count beneath a Synthetic back-relation gates each row on its declared rows', async () => {
    await seedShelves()

    const rows = await observe('a count beneath a Synthetic back-relation', 'traversal', () =>
      database
        .context(member)
        .db.Coach.orderBy({ id: 'asc' })
        .include('from_Shelf_keeper', (shelves) =>
          shelves.include('books', (books) => books.count()),
        )
        .all(),
    )

    expect(rows).toEqual([
      { id: 1, name: 'c1', listed: true, from_Shelf_keeper: [shelf(1, 2, 2), shelf(3, 0, 0)] },
    ])
    expect(callsTo('read', 'Shelf.keeper').slice(0, 2)).toEqual([
      ['read', 'Shelf.keeper', 'sh1', ['b1', 'b2']],
      ['read', 'Shelf.keeper', 'sh3', []],
    ])
    expect(blurbed()).toEqual([])
  })
})

describe('a hook mutating declared rows in place', () => {
  test("a count's declared stand-in is fresh for the foreign-key pass", async () => {
    await seedShelves()

    const rows = await observe("a hook pushing into a count's declared stand-in", 'traversal', () =>
      database
        .context(mutating)
        .db.Shelf.where({ id: { equals: 1 } })
        .include('books', (books) => books.count())
        .all(),
    )

    expect(rows).toEqual([shelf(1, 2, 2)])
    expect(callsTo('read', 'Shelf.keeper')).toEqual([['read', 'Shelf.keeper', 'sh1', ['b1', 'b2']]])
  })

  test("a rows branch's declared rows are shared with the foreign-key pass", async () => {
    await seedShelves()

    const rows = await observe(
      "a hook pushing into a rows branch's declared rows",
      'traversal',
      () =>
        database
          .context(mutating)
          .db.Shelf.where({ id: { equals: 1 } })
          .include('books', (books) => books.combine({ total: books.count(), all: books }))
          .all(),
    )

    expect(rows).toEqual([
      { ...shelf(1, { total: 2, all: [book(1), book(2)] }, 2), keeperId: null },
    ])
    expect(callsTo('read', 'Shelf.keeper')).toEqual([
      ['read', 'Shelf.keeper', 'sh1', ['b1', 'b2', 'INJECTED']],
    ])
  })

  test("a caller-shaped declared relation's unshaped rows are shared with the foreign-key pass", async () => {
    await seedShelves()

    const rows = await observe(
      "a hook pushing into a caller-shaped declared relation's rows",
      'traversal',
      () =>
        database
          .context(mutating)
          .db.Shelf.where({ id: { equals: 1 } })
          .include('books', (books) => books.limit(1))
          .all(),
    )

    expect(rows).toEqual([{ ...shelf(1, [book(1)], 2), keeperId: null }])
    expect(callsTo('read', 'Shelf.keeper')).toEqual([
      ['read', 'Shelf.keeper', 'sh1', ['b1', 'b2', 'INJECTED']],
    ])
  })
})

describe('the row lock with includes and reductions', () => {
  test('forUpdate().all() re-reads and shows includes and a reduction', async () => {
    await seedLeague()
    await seedShelves(false)

    const read = await observe('forUpdate().all() with includes and a reduction', 'traversal', () =>
      database.context(member).transaction(async (tx) => ({
        shelves: await tx.db.Shelf.orderBy({ id: 'asc' })
          .include('books', (books) => books.count())
          .forUpdate()
          .all(),
        teams: await tx.db.Team.where({ id: { in: [1, 2] } })
          .orderBy({ id: 'asc' })
          .include('players', (players) => players.include('awards', (awards) => awards.count()))
          .forUpdate()
          .all(),
      })),
    )

    const team = (id: number) => ({
      ...shownTeam(id),
      players: [id * 2 - 1, id * 2].map((player) => ({ ...shownPlayer(player), awards: 2 })),
    })
    expect(read).toEqual({
      shelves: [shelf(1, 2, 2), shelf(2, 1, 1), shelf(3, 0, 0)],
      teams: [team(1), team(2)],
    })
  })

  test('forUpdate().first() re-reads and shows a combine rows branch', async () => {
    await seedShelves()

    const row = await observe('forUpdate().first() with a combine rows branch', 'traversal', () =>
      database.context(member).transaction((tx) =>
        tx.db.Shelf.where({ id: { equals: 1 } })
          .include('books', (books) => books.combine({ total: books.count(), all: books }))
          .forUpdate()
          .first(),
      ),
    )

    expect(row).toEqual(shelf(1, { total: 2, all: [book(1), book(2)] }, 2))
    expect(weighed()).toEqual([['b1', 'b2']])
  })
})

describe('writes on a list declaring a relation', () => {
  test('update returns the re-read row computed over the declared rows', async () => {
    await seedShelves()

    const updated = await observe('update on a list declaring a relation', 'traversal', () =>
      database.context(member).db.Shelf.update({ where: { id: 1 }, data: { name: 'sh1' } }),
    )

    expect(updated).toEqual(shelf(1, undefined, 2))
    expect(weighed()).toEqual([['b1', 'b2']])
    expect(blurbed()).toEqual([])
  })

  test('delete returns the row as it stood, computed over the declared rows', async () => {
    await seedShelves()

    const deleted = await observe('delete on a list declaring a relation', 'traversal', () =>
      database.context(member).db.Shelf.delete({ where: { id: 3 } }),
    )

    expect(deleted).toEqual(shelf(3, undefined, 0))
    expect(weighed()).toEqual([[]])
  })
})
