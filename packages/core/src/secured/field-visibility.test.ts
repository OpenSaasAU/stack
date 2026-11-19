import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import type { Session } from '../access/types.js'
import { integer, json, relationship, text, virtual } from '../fields/index.js'
import { withOrigin } from '../origin.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { READ_INCLUDE_MAX_DEPTH } from '../access/depth-limits.js'

const BOOT = 120_000

function multiColumn(
  options: { access?: FieldConfig['access']; namesColumns?: boolean; assembles?: boolean } = {},
): FieldConfig {
  const field = json({ access: options.access })
  const columns = ['avatar_filename', 'avatar_filesize']
  field.getContractField = () => ({
    kind: 'columns',
    columns: [
      { name: columns[0], type: { pack: 'pg', type: 'text' }, nullable: true },
      { name: columns[1], type: { pack: 'pg', type: 'int' }, nullable: true },
    ],
  })
  if (options.namesColumns !== false) field.getColumnNames = () => columns
  if (options.assembles !== false) {
    field.assembleColumns = (_fieldName, row) => ({
      filename: row[columns[0]],
      filesize: row[columns[1]],
    })
  }
  field.splitColumns = (_fieldName, value) => {
    const metadata: { filename?: unknown; filesize?: unknown } =
      typeof value === 'object' && value !== null ? value : {}
    return { [columns[0]]: metadata.filename ?? null, [columns[1]]: metadata.filesize ?? null }
  }
  return field
}

const CHAIN_LENGTH = READ_INCLUDE_MAX_DEPTH + 1

function chain(): OpenSaasConfig['lists'] {
  const names = Array.from({ length: CHAIN_LENGTH }, (_, index) => `D${index + 1}`)
  const lists: OpenSaasConfig['lists'] = {}
  names.forEach((name, index) => {
    const next = names[index + 1]
    const previous = names[index - 1]
    lists[name] = {
      fields: {
        label: text({ hooks: { resolveOutput: ({ value }) => `resolved:${String(value)}` } }),
        secret: text({ access: { read: () => false } }),
        ...(next ? { next: relationship({ ref: `${next}.prev`, many: true }) } : {}),
        ...(previous ? { prev: relationship({ ref: `${previous}.next` }) } : {}),
      },
      access: { operation: { query: () => true } },
    }
  })
  return lists
}

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Person: {
      fields: {
        name: text(),
        salary: integer({ access: { read: ({ session }) => session?.role === 'admin' } }),
      },
      access: { operation: { query: () => true } },
    },
    Author: {
      fields: {
        name: text(),
        email: text({ access: { read: () => false } }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
      access: { operation: { query: () => true } },
    },
    Post: {
      fields: {
        title: text(),
        internalNotes: text({ access: { read: () => false } }),
        author: relationship({ ref: 'Author.posts' }),
      },
      access: { operation: { query: () => true } },
    },
    Profile: {
      fields: {
        title: text(),
        avatar: multiColumn(),
      },
      access: { operation: { query: () => true } },
    },
    UnnamedParts: {
      fields: { title: text(), avatar: multiColumn({ namesColumns: false }) },
      access: { operation: { query: () => true } },
    },
    HiddenAvatar: {
      fields: { title: text(), avatar: multiColumn({ access: { read: () => false } }) },
      access: { operation: { query: () => true } },
    },
    RawParts: {
      fields: {
        title: text(),
        avatar: multiColumn({
          assembles: false,
          access: { read: ({ session }) => session?.role === 'admin' },
        }),
      },
      access: { operation: { query: () => true } },
    },
    Term: {
      fields: { name: text() },
      access: { operation: { query: () => true } },
    },
    Bill: {
      fields: {
        amount: integer(),
        term: relationship({ ref: 'Term' }),
        internalNotes: text({ access: { read: () => false } }),
        label: virtual({
          type: 'string',
          needs: ['amount'],
          hooks: { resolveOutput: ({ item }) => `Bill #${String(item.amount)}` },
        }),
      },
      access: { operation: { query: () => true } },
    },
    ...chain(),
  },
}

let database: TestDatabase

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('not a to-many')
  return value.filter(isRecord)
}

function collection(model: string): Record<string, unknown> {
  const namespace: unknown = Reflect.get(database.client.orm, 'public')
  if (!isRecord(namespace)) throw new Error('no public namespace')
  const found: unknown = Reflect.get(namespace, model)
  if (!isRecord(found)) throw new Error(`no collection "${model}"`)
  return found
}

function seed(model: string, row: object): Promise<Record<string, unknown>> {
  const target = collection(model)
  const create: unknown = target.create
  if (typeof create !== 'function') throw new Error(`collection "${model}" has no create`)
  return withOrigin('unsafe', async () => {
    const created: unknown = await create.call(target, row)
    if (!isRecord(created)) throw new Error('create returned no row')
    return created
  })
}

const admin: Session = { role: 'admin' }
const member: Session = { role: 'member' }

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  await database.truncate()
})

describe('a field read rule keyed on the session', () => {
  test(
    'the same row reads with the field for one role and without it for another',
    async () => {
      await seed('Person', { name: 'ada', salary: 100_000 })

      const asMember = await database.context(member).db.Person.first()
      const asAdmin = await database.context(admin).db.Person.first()

      expect(asMember).toMatchObject({ name: 'ada' })
      expect(asMember).not.toHaveProperty('salary')
      expect(asAdmin).toMatchObject({ name: 'ada', salary: 100_000 })
    },
    BOOT,
  )
})

describe('a multi-column field under a projection', () => {
  test(
    'a projection that does not name the field returns neither the field nor its part columns',
    async () => {
      await seed('Profile', { title: 'hi', avatar_filename: 'ada.png', avatar_filesize: 12 })

      const [projected] = await database.context(null).db.Profile.select('title').all()
      const [whole] = await database.context(null).db.Profile.all()

      expect(projected).toMatchObject({ title: 'hi' })
      expect(projected).not.toHaveProperty('avatar')
      expect(projected).not.toHaveProperty('avatar_filename')
      expect(projected).not.toHaveProperty('avatar_filesize')
      expect(whole.avatar).toEqual({ filename: 'ada.png', filesize: 12 })
    },
    BOOT,
  )
})

describe('a multi-column field read', () => {
  test(
    'is assembled from the part columns its contract descriptor names, without getColumnNames',
    async () => {
      await seed('UnnamedParts', { title: 'hi', avatar_filename: 'ada.png', avatar_filesize: 12 })

      const row = await database.context(null).db.UnnamedParts.first()

      expect(row?.avatar).toEqual({ filename: 'ada.png', filesize: 12 })
      expect(row).not.toHaveProperty('avatar_filename')
      expect(row).not.toHaveProperty('avatar_filesize')
    },
    BOOT,
  )

  test(
    'returns neither the field nor its part columns when its read rule denies',
    async () => {
      await seed('HiddenAvatar', { title: 'hi', avatar_filename: 'ada.png', avatar_filesize: 12 })

      const row = await database.context(null).db.HiddenAvatar.first()

      expect(row).toMatchObject({ title: 'hi' })
      expect(row).not.toHaveProperty('avatar')
      expect(row).not.toHaveProperty('avatar_filename')
      expect(row).not.toHaveProperty('avatar_filesize')
    },
    BOOT,
  )
})

describe('a multi-column field without assembleColumns', () => {
  test(
    'returns its raw part columns to a session its read rule allows',
    async () => {
      await seed('RawParts', { title: 'hi', avatar_filename: 'ada.png', avatar_filesize: 12 })

      const row = await database.context(admin).db.RawParts.first()

      expect(row).toMatchObject({
        title: 'hi',
        avatar_filename: 'ada.png',
        avatar_filesize: 12,
      })
    },
    BOOT,
  )
})

describe('a read-denied field on an included relation', () => {
  test(
    'is stripped from a plain included to-one, and its siblings are kept',
    async () => {
      const author = await seed('Author', { name: 'ada', email: 'ada@example.com' })
      await seed('Post', { title: 'p1', internalNotes: 'n1', authorId: author.id })

      const [post] = await database.context(null).db.Post.include('author').all()

      expect(isRecord(post.author)).toBe(true)
      expect(post.author).toMatchObject({ name: 'ada' })
      expect(post.author).not.toHaveProperty('email')
    },
    BOOT,
  )

  test(
    'is stripped from every row of a plain included to-many',
    async () => {
      const author = await seed('Author', { name: 'ada', email: 'ada@example.com' })
      await seed('Post', { title: 'p1', internalNotes: 'n1', authorId: author.id })
      await seed('Post', { title: 'p2', internalNotes: 'n2', authorId: author.id })

      const [row] = await database.context(null).db.Author.include('posts').all()
      const posts = records(row.posts)

      expect(posts.map((post) => post.title).sort()).toEqual(['p1', 'p2'])
      for (const post of posts) expect(post).not.toHaveProperty('internalNotes')
    },
    BOOT,
  )
})

describe('Field Visibility at the include depth cap', () => {
  test(
    'a read-denied field is stripped and a resolveOutput hook runs on the deepest level',
    async () => {
      let previous: Record<string, unknown> | undefined
      for (let index = 1; index <= CHAIN_LENGTH; index += 1) {
        previous = await seed(`D${index}`, {
          label: `d${index}`,
          secret: `secret${index}`,
          ...(previous ? { prevId: previous.id } : {}),
        })
      }

      const rows = await database
        .context(null)
        .db.D1.include('next', (d2) =>
          d2.include('next', (d3) =>
            d3.include('next', (d4) => d4.include('next', (d5) => d5.include('next'))),
          ),
        )
        .all()

      let level: Record<string, unknown> = rows[0]
      for (let depth = 1; depth <= READ_INCLUDE_MAX_DEPTH; depth += 1) {
        const [next] = records(level.next)
        level = next
      }

      expect(level.label).toBe(`resolved:d${CHAIN_LENGTH}`)
      expect(level).not.toHaveProperty('secret')
    },
    BOOT,
  )
})

describe('rows reached through a Synthetic back-relation', () => {
  test(
    "are stripped of the related list's own read-denied field",
    async () => {
      const term = await seed('Term', { name: 't1' })
      await seed('Bill', { amount: 5, internalNotes: 'secret', termId: term.id })

      const [row] = await database.context(null).db.Term.include('from_Bill_term').all()
      const bills = records(row.from_Bill_term)

      expect(bills).toHaveLength(1)
      expect(bills[0]).toMatchObject({ amount: 5 })
      expect(bills[0]).not.toHaveProperty('internalNotes')
    },
    BOOT,
  )

  test(
    "carry the related list's computed field",
    async () => {
      const term = await seed('Term', { name: 't1' })
      await seed('Bill', { amount: 5, termId: term.id })
      await seed('Bill', { amount: 9, termId: term.id })

      const [row] = await database.context(null).db.Term.include('from_Bill_term').all()

      expect(
        records(row.from_Bill_term)
          .map((bill) => bill.label)
          .sort(),
      ).toEqual(['Bill #5', 'Bill #9'])
    },
    BOOT,
  )
})
