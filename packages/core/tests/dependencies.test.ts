import { describe, expect, it } from 'vitest'
import {
  deriveConstraintMap,
  deriveDependencyTable,
  deriveGeneratedTables,
} from '../src/contract/dependencies.js'
import { deriveContract } from '../src/contract/derive.js'
import {
  authConfig,
  blogConfig,
  multiSchemaConfig,
  oneToOneConfig,
} from './fixtures/contract-configs.js'
import { text } from '../src/fields/index.js'
import type { OpenSaasConfig } from '../src/config/types.js'

/** A config whose only content is one list of text fields, built through the real builders. */
function textListConfig(fields: Record<string, ReturnType<typeof text>>): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: { Doc: { fields } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a minimal config, not a builder-produced one
  } as any
}

describe('deriveDependencyTable', () => {
  it('resolves the blog fixture into one-hop sets and per-list system fields', () => {
    const table = deriveDependencyTable(blogConfig)

    expect(table.Post.fields.byline).toEqual({ columns: ['authorId'], relations: ['author'] })
    expect(table.Post.fields.excerpt).toEqual({ columns: ['content', 'title'], relations: [] })
    // A computed field that declares nothing still has a row — its set is empty.
    expect(table.User.fields.displayName).toEqual({ columns: [], relations: [] })
    // Every field with a `resolveOutput` is a computed field here, virtual or
    // not — `calendarDay()`'s own output hook puts `publishDate` in the table.
    expect(Object.keys(table.Post.fields).sort()).toEqual(['byline', 'excerpt', 'publishDate'])

    expect(table.Post.systemFields).toEqual(['id', 'createdAt', 'updatedAt'])
    expect(table.User.systemFields).toEqual(['id', 'createdAt', 'updatedAt'])
  })

  it('lists only `id` for a list with db.timestamps: false', () => {
    expect(deriveDependencyTable(blogConfig).Category.systemFields).toEqual(['id'])
  })

  it('carries the foreign-key column only on the side that owns it', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Order: {
          fields: {
            lineItems: { type: 'relationship', ref: 'LineItem.order', many: true },
            total: {
              type: 'virtual',
              virtual: true,
              needs: ['lineItems'],
              hooks: { resolveOutput: () => 0 },
            },
          },
        },
        LineItem: {
          fields: {
            order: { type: 'relationship', ref: 'Order.lineItems' },
            label: {
              type: 'virtual',
              virtual: true,
              needs: ['order'],
              hooks: { resolveOutput: () => '' },
            },
          },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a minimal config, not a builder-produced one
    } as any

    const table = deriveDependencyTable(config)
    // The to-many side owns no column, so declaring it implies none.
    expect(table.Order.fields.total).toEqual({ columns: [], relations: ['lineItems'] })
    // The to-one side owns `orderId`, so declaring the relation carries it.
    expect(table.LineItem.fields.label).toEqual({ columns: ['orderId'], relations: ['order'] })
  })

  it('is deterministic: lists, fields and set members come back sorted', () => {
    const table = deriveDependencyTable(authConfig)
    expect(Object.keys(table)).toEqual([...Object.keys(table)].sort())
    for (const entry of Object.values(table)) {
      expect(Object.keys(entry.fields)).toEqual([...Object.keys(entry.fields)].sort())
    }
    expect(JSON.stringify(table)).toBe(JSON.stringify(deriveDependencyTable(authConfig)))
  })
})

describe('deriveConstraintMap', () => {
  it('names every unique the blog fixture emits, including the named db.indexes entry', () => {
    const map = deriveConstraintMap(blogConfig, deriveContract(blogConfig))

    expect(map.User_email_key).toEqual({ list: 'User', fields: ['email'] })
    expect(map.Post_slug_key).toEqual({ list: 'Post', fields: ['slug'] })
    expect(map.Post_pkey).toEqual({ list: 'Post', fields: ['id'] })
    expect(map.Category_pkey).toEqual({ list: 'Category', fields: ['id'] })
    // `post_author_status` is a plain index, not a unique — it is not a violation source.
    expect(map.post_author_status).toBeUndefined()
  })

  it('names the unique on the owning column of a one-to-one, by its field key', () => {
    const map = deriveConstraintMap(oneToOneConfig, deriveContract(oneToOneConfig))

    expect(map.Profile_user_key).toEqual({ list: 'Profile', fields: ['user'] })
    // `Passport` sorts before `Person`, so `Passport.holder` owns the column.
    expect(map.Passport_holder_key).toEqual({ list: 'Passport', fields: ['holder'] })
    // `partner` sorts before `spouse` on the self-referential pair.
    expect(map.Person_partner_key).toEqual({ list: 'Person', fields: ['partner'] })
  })

  it('adopts a db.indexes unique entry under its exact declared name', () => {
    const map = deriveConstraintMap(authConfig, deriveContract(authConfig))
    expect(map.RateLimit_key_key).toEqual({ list: 'RateLimit', fields: ['key'] })
  })

  it('builds the name from the physical table and column names', () => {
    // The auth `User` list maps to table `user`, so its constraints are named
    // from the table, not the list.
    const map = deriveConstraintMap(authConfig, deriveContract(authConfig))
    expect(map.user_email_key).toEqual({ list: 'User', fields: ['email'] })
    expect(map.user_pkey).toEqual({ list: 'User', fields: ['id'] })
  })

  it('names a constraint on a list in a non-default namespace', () => {
    // `Session` lives in the `auth` schema and maps to table `session`.
    const map = deriveConstraintMap(multiSchemaConfig, deriveContract(multiSchemaConfig))
    expect(map.session_token_key).toEqual({ list: 'Session', fields: ['token'] })
  })

  // The expected names below are literals, not a rerun of the implementation's
  // own rule. PGlite is what pins them — `contract-engine.test.ts` asserts the
  // map's key set equals PostgreSQL's `conname` set for a fixture that overflows
  // both ways.
  it('clips an over-long unique to its leading 63 bytes, the way Prisma’s own name reaches PostgreSQL', () => {
    const longField = 'c'.repeat(70)
    const config = textListConfig({ [longField]: text({ isIndexed: 'unique' }) })

    const map = deriveConstraintMap(config, deriveContract(config))
    // `Doc_<70 c's>_key` is 78 bytes; PostgreSQL keeps the leading 63 and the
    // `_key` suffix is gone.
    const name = `Doc_${'c'.repeat(59)}`
    expect(name).toHaveLength(63)
    expect(map[name]).toEqual({ list: 'Doc', fields: [longField] })
  })

  it('shrinks the table component of an over-long primary key, keeping the _pkey PostgreSQL reserves', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: { Doc: { fields: { title: text() }, db: { map: 'A'.repeat(60) } } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a minimal config, not a builder-produced one
    } as any

    const map = deriveConstraintMap(config, deriveContract(config))
    const name = `${'A'.repeat(58)}_pkey`
    expect(name).toHaveLength(63)
    expect(map[name]).toEqual({ list: 'Doc', fields: ['id'] })
  })

  it('refuses two constraints whose derived names collide after truncation, naming both', () => {
    const shared = 'a'.repeat(59)
    const config = textListConfig({
      [`${shared}One`]: text({ isIndexed: 'unique' }),
      [`${shared}Two`]: text({ isIndexed: 'unique' }),
    })

    expect(() => deriveConstraintMap(config, deriveContract(config))).toThrow(
      /is emitted by both list "Doc"/,
    )
  })

  it('offers db.map, not a db.indexes name, when the collision is between two primary keys', () => {
    // Two lists in different schemas mapped to the same table name: the key
    // omits the namespace (a recorded limit), so their `_pkey` names collide.
    // A primary key cannot adopt a `db.indexes` name, so that remedy would be
    // unusable here.
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql', schemas: ['public', 'auth'] },
      lists: {
        PublicUser: { fields: { name: text() }, db: { map: 'user' } },
        AuthUser: { fields: { name: text() }, db: { map: 'user', schema: 'auth' } },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a minimal config, not a builder-produced one
    } as any

    expect(() => deriveConstraintMap(config, deriveContract(config))).toThrow(/db\.map/)
    expect(() => deriveConstraintMap(config, deriveContract(config))).not.toThrow(/db\.indexes/)
  })
})

describe('deriveGeneratedTables', () => {
  it('returns both tables from one pass', () => {
    const tables = deriveGeneratedTables(blogConfig, deriveContract(blogConfig))
    expect(tables.dependencies).toEqual(deriveDependencyTable(blogConfig))
    expect(tables.constraints.User_email_key).toEqual({ list: 'User', fields: ['email'] })
  })
})
