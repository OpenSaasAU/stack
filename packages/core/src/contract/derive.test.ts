import { describe, expect, test } from 'vitest'
import type { BaseFieldConfig, OpenSaasConfig, TypeInfo } from '../config/types.js'
import { decimal, integer, json, relationship, select, text, timestamp } from '../fields/index.js'
import { deriveContract } from './derive.js'

function single(lists: OpenSaasConfig['lists'], db: Partial<OpenSaasConfig['db']> = {}) {
  return deriveContract({ db: { provider: 'postgresql', ...db }, lists })
}

describe('deriveContract — ids', () => {
  test('uuid7 is the default; the config default and the per-list override each win in turn', () => {
    const data = single(
      {
        A: { fields: { name: text() } },
        B: { fields: { name: text() }, db: { idField: 'cuid2' } },
        C: { fields: { name: text() }, db: { idField: 'int autoincrement' } },
      },
      { idField: 'uuid7' },
    )
    expect(data.models.map((m) => m.id)).toEqual([
      { strategy: 'uuid7', type: { pack: 'pg', type: 'uuid' } },
      { strategy: 'cuid2', type: { pack: 'pg', type: 'char', args: [24] } },
      { strategy: 'int autoincrement', type: { pack: 'pg', type: 'int' } },
    ])
    expect(single({ A: { fields: { name: text() } } }).models[0].id.strategy).toBe('uuid7')
    expect(
      single({ A: { fields: { name: text() } } }, { idField: 'int autoincrement' }).models[0].id
        .strategy,
    ).toBe('int autoincrement')
  })

  test('a singleton derives an integer id regardless of the config default', () => {
    const data = single(
      { Settings: { fields: { name: text() }, isSingleton: true } },
      { idField: 'cuid2' },
    )
    expect(data.models[0]).toMatchObject({
      singleton: true,
      id: { strategy: 'singleton', type: { pack: 'pg', type: 'int' } },
    })
  })

  test('a foreign-key column takes the referenced list id type', () => {
    const data = single({
      Invoice: {
        fields: { lines: relationship({ ref: 'Line.invoice', many: true }) },
        db: { idField: 'int autoincrement' },
      },
      Line: { fields: { invoice: relationship({ ref: 'Invoice.lines' }) } },
    })
    expect(data.models[1].columns).toEqual([
      {
        name: 'invoiceId',
        type: { pack: 'pg', type: 'int' },
        nullable: true,
        map: 'invoice',
        index: true,
      },
    ])
  })
})

describe('deriveContract — columns', () => {
  test('a db.nativeType override folds into the type descriptor', () => {
    const data = single({
      A: {
        fields: {
          code: text({ db: { nativeType: 'VarChar(255)' } }),
          amount: decimal({ db: { nativeType: 'Decimal(10, 2)' } }),
          ratio: decimal({ db: { nativeType: 'Real' } }),
          raw: json({ db: { nativeType: 'Json' } }),
          doc: json({ db: { nativeType: 'JsonB' } }),
          day: timestamp({ db: { nativeType: 'Date' } }),
          takenAt: timestamp({ db: { nativeType: 'Timestamp(3)' } }),
          seenAt: timestamp({ db: { nativeType: 'Timestamptz(6)' } }),
          atTime: timestamp({ db: { nativeType: 'Time(0)' } }),
          plain: timestamp({ db: { nativeType: 'Timestamp' } }),
        },
      },
    })
    expect(data.models[0].columns.map((c) => c.type)).toEqual([
      { pack: 'pg', type: 'varchar', args: [255] },
      { pack: 'pg', type: 'decimal', args: [10, 2] },
      { pack: 'pg', type: 'real' },
      { pack: 'pg', type: 'json' },
      { pack: 'pg', type: 'jsonb' },
      { pack: 'pg', type: 'date' },
      { pack: 'pg', type: 'timestamp', args: [3] },
      { pack: 'pg', type: 'timestamptz', args: [6] },
      { pack: 'pg', type: 'time', args: [0] },
      { pack: 'pg', type: 'timestamp' },
    ])
    expect(data.models[0].columns[0]).not.toHaveProperty('nativeType')
  })

  test('the builders default decimal to (18, 4) and json to jsonb', () => {
    const data = single({ A: { fields: { amount: decimal(), doc: json() } } })
    expect(data.models[0].columns.map((c) => c.type)).toEqual([
      { pack: 'pg', type: 'decimal', args: [18, 4] },
      { pack: 'pg', type: 'jsonb' },
    ])
  })

  test.each([
    ['Citext', /which is not a Postgres type the contract can carry/],
    ['VarChar(lots)', /argument "lots" is not an integer/],
    ['VarChar', /but VarChar takes 1 argument — write VarChar\(n\)/],
    ['Text(5)', /but Text takes 0 arguments/],
    ['Decimal(1, 2, 3)', /but Decimal takes between 0 and 2 arguments/],
    ['Timestamp(9)', /precision must be between 0 and 6/],
  ])('refuses db.nativeType %s naming the field', (nativeType, message) => {
    expect(() => single({ A: { fields: { code: text({ db: { nativeType } }) } } })).toThrow(message)
    expect(() => single({ A: { fields: { code: text({ db: { nativeType } }) } } })).toThrow(
      /List "A": fields\.code sets db\.nativeType/,
    )
  })

  test('a field without getContractField is refused naming the field and its type', () => {
    const legacy: BaseFieldConfig<TypeInfo> = { type: 'legacy' }
    expect(() => single({ A: { fields: { thing: legacy } } })).toThrow(
      /Field "A\.thing" \(type "legacy"\) does not implement getContractField/,
    )
  })

  test('an extension-typed column keeps its pack; declared packs are deduplicated', () => {
    const embedding: BaseFieldConfig<TypeInfo> = {
      type: 'vector',
      getContractField: (name) => ({
        kind: 'column',
        name,
        type: { pack: 'pgvector', type: 'Vector', args: [3] },
        nullable: true,
      }),
    }
    const data = single(
      { Doc: { fields: { embedding } } },
      {
        extensions: [
          { name: 'pgvector', from: 'pkg' },
          { name: 'pgvector', from: 'pkg' },
        ],
      },
    )
    expect(data.extensions).toEqual([{ name: 'pgvector', from: 'pkg' }])
    expect(data.models[0].columns[0].type).toEqual({ pack: 'pgvector', type: 'Vector', args: [3] })
  })

  test('a multi-column field contributes every column', () => {
    const image: BaseFieldConfig<TypeInfo> = {
      type: 'image',
      getContractField: (name) => ({
        kind: 'columns',
        columns: [
          { name: `${name}_id`, type: { pack: 'pg', type: 'text' }, nullable: true },
          { name: `${name}_width`, type: { pack: 'pg', type: 'int' }, nullable: true },
        ],
      }),
    }
    expect(
      single({ A: { fields: { avatar: image } } }).models[0].columns.map((c) => c.name),
    ).toEqual(['avatar_id', 'avatar_width'])
  })

  test('enums are collected once; one name with two value sets is refused', () => {
    const options = [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
    ]
    const data = single({
      X: { fields: { kind: select({ options, db: { type: 'enum', enumName: 'Kind' } }) } },
      Y: { fields: { kind: select({ options, db: { type: 'enum', enumName: 'Kind' } }) } },
    })
    expect(data.enums).toEqual([{ name: 'Kind', values: ['a', 'b'] }])
    expect(() =>
      single({
        X: { fields: { kind: select({ options, db: { type: 'enum', enumName: 'Kind' } }) } },
        Y: {
          fields: {
            kind: select({ options: [options[0]], db: { type: 'enum', enumName: 'Kind' } }),
          },
        },
      }),
    ).toThrow(/Enum "Kind" is declared with different values/)
  })

  test('list db.map and db.schema carry through; timestamps follow the per-list override', () => {
    const data = single(
      {
        A: { fields: { name: text() }, db: { map: 'a_table', schema: 'auth', timestamps: false } },
        B: { fields: { createdAt: timestamp(), name: text() } },
      },
      { timestamps: true },
    )
    expect(data.models[0]).toMatchObject({
      table: 'a_table',
      namespace: 'auth',
      timestamps: { createdAt: false, updatedAt: false },
    })
    expect(data.models[1].timestamps).toEqual({ createdAt: false, updatedAt: true })
  })

  test('namespaces are db.schemas unioned with every db.schema, minus the default public', () => {
    expect(single({ A: { fields: { name: text() } } }).namespaces).toEqual([])
    const data = single(
      {
        A: { fields: { name: text() }, db: { schema: 'billing' } },
        B: { fields: { name: text() }, db: { schema: 'auth' } },
      },
      { schemas: ['public', 'auth'] },
    )
    expect(data.namespaces).toEqual(['auth', 'billing'])
  })
})

describe('deriveContract — relations', () => {
  test('an implicit many-to-many is refused even before the config refusals run', () => {
    expect(() =>
      single({
        A: { fields: { bs: relationship({ ref: 'B.as', many: true }) } },
        B: { fields: { as: relationship({ ref: 'A.bs', many: true }) } },
      }),
    ).toThrow(/List "A": fields\.bs and list "B": fields\.as are both many: true/)
  })

  test('a list-only ref with many: true is refused as a many-to-many, not as a missing inverse', () => {
    expect(() =>
      single({
        Post: { fields: { tags: relationship({ ref: 'Tag', many: true }) } },
        Tag: { fields: { name: text() } },
      }),
    ).toThrow(
      /List "Post": fields\.tags is many: true with the list-only ref "Tag" — an implicit many-to-many/,
    )
  })

  test('a bidirectional ref whose other end does not ref back is refused naming both ends', () => {
    expect(() =>
      single({
        User: { fields: { posts: relationship({ ref: 'Post.editor', many: true }) } },
        Org: { fields: { posts: relationship({ ref: 'Post.editor', many: true }) } },
        Post: { fields: { editor: relationship({ ref: 'Org.posts' }) } },
      }),
    ).toThrow(
      /List "User": fields\.posts refs "Post\.editor", but "Post\.editor" refs "Org\.posts" rather than "User\.posts"/,
    )
  })

  test('an unknown target list is refused naming the field', () => {
    expect(() => single({ A: { fields: { b: relationship({ ref: 'B' }) } } })).toThrow(
      /List "A": fields\.b references list "B", which is not in the config/,
    )
  })

  test('a foreign-key map that equals the column name is not carried', () => {
    const data = single({
      A: { fields: { b: relationship({ ref: 'B', db: { foreignKey: { map: 'bId' } } }) } },
      B: { fields: { name: text() } },
    })
    expect(data.models[0].columns[0]).not.toHaveProperty('map')
    const mapped = single({
      A: { fields: { b: relationship({ ref: 'B', db: { foreignKey: { map: 'b_ref' } } }) } },
      B: { fields: { name: text() } },
    })
    expect(mapped.models[0].columns[0].map).toBe('b_ref')
  })

  test('isIndexed on a relationship shapes the FK column: false drops the index, unique replaces it', () => {
    const data = single({
      A: {
        fields: {
          plain: relationship({ ref: 'B', isIndexed: false }),
          only: relationship({ ref: 'B', isIndexed: 'unique' }),
        },
      },
      B: { fields: { name: text() } },
    })
    expect(data.models[0].columns).toEqual([
      { name: 'plainId', type: { pack: 'pg', type: 'uuid' }, nullable: true, map: 'plain' },
      {
        name: 'onlyId',
        type: { pack: 'pg', type: 'uuid' },
        nullable: true,
        map: 'only',
        unique: true,
      },
    ])
  })
})

describe('deriveContract — member collisions are refused as a backstop', () => {
  test('a field named id', () => {
    expect(() => single({ A: { fields: { id: text() } } })).toThrow(
      /List "A": fields\.id derives the contract member "id", which the id column already claims/,
    )
  })

  test('a field named after an owned foreign-key column', () => {
    expect(() =>
      single({
        Post: { fields: { author: relationship({ ref: 'User' }), authorId: text() } },
        User: { fields: { name: text() } },
      }),
    ).toThrow(
      /List "Post": fields\.authorId derives the contract member "authorId", which the foreign-key column of fields\.author already claims/,
    )
  })

  test('a field named after the synthetic back-relation a list-only ref puts on the target', () => {
    expect(() =>
      single({
        Post: { fields: { category: relationship({ ref: 'Category' }) } },
        Category: { fields: { from_Post_category: text() } },
      }),
    ).toThrow(
      /List "Category": the back-relation synthesised for the list-only ref on "Post\.category" derives the contract member "from_Post_category", which fields\.from_Post_category already claims/,
    )
  })
})

describe('deriveContract — db.indexes resolution', () => {
  const b = { fields: { name: text() } }

  test('resolves scalars, owned foreign keys and auto-timestamps to columns', () => {
    const data = single(
      {
        A: {
          fields: { name: text(), b: relationship({ ref: 'B', isIndexed: false }) },
          db: { indexes: [{ fields: ['name', 'b', 'createdAt'], unique: true, name: 'a_name_b' }] },
        },
        B: b,
      },
      { timestamps: true },
    )
    expect(data.models[0].indexes).toEqual([
      { columns: ['name', 'bId', 'createdAt'], unique: true, name: 'a_name_b' },
    ])
  })

  test.each([
    [{ fields: [] }, /has an empty "fields" array/],
    [{ fields: ['missing'] }, /references unknown field "missing"/],
    [{ fields: ['updatedAt'] }, /references unknown field "updatedAt"/],
    [{ fields: ['computed'] }, /references virtual field "computed"/],
    [{ fields: ['bs'] }, /references to-many relationship field "bs"/],
    [
      { fields: ['name'] },
      /duplicates the constraint already produced by field "name"'s isIndexed: 'unique'/,
    ],
    [{ fields: ['pic'] }, /maps to more than one database column/],
  ])('refuses %j', (index, message) => {
    const pic: BaseFieldConfig<TypeInfo> = {
      type: 'image',
      getContractField: (name) => ({
        kind: 'columns',
        columns: [{ name: `${name}_id`, type: { pack: 'pg', type: 'text' }, nullable: true }],
      }),
    }
    expect(() =>
      single({
        A: {
          fields: {
            name: text({ isIndexed: 'unique' }),
            computed: {
              type: 'virtual',
              virtual: true,
              getContractField: () => ({ kind: 'computed' }),
            },
            bs: relationship({ ref: 'B.a', many: true }),
            pic,
          },
          db: { indexes: [index] },
        },
        B: { fields: { a: relationship({ ref: 'A.bs' }) } },
      }),
    ).toThrow(message)
  })

  test('refuses the non-owning side of a one-to-one, which has no column', () => {
    expect(() =>
      single({
        A: { fields: { b: relationship({ ref: 'B.a' }) }, db: { indexes: [{ fields: ['b'] }] } },
        B: { fields: { a: relationship({ ref: 'A.b', db: { foreignKey: true } }) } },
      }),
    ).toThrow(/relationship field "b", which does not own a foreign key column on this model/)
  })

  test('an integer isIndexed: true collides with a single-field entry on the same column', () => {
    expect(() =>
      single({
        A: { fields: { n: integer({ isIndexed: true }) }, db: { indexes: [{ fields: ['n'] }] } },
      }),
    ).toThrow(/isIndexed: true — both would emit an index on "n"/)
  })

  test("a relationship's default index yields to a single-field entry, which then names it", () => {
    const data = single({
      A: {
        fields: { b: relationship({ ref: 'B' }) },
        db: { indexes: [{ fields: ['b'], name: 'A_b_idx' }] },
      },
      B: b,
    })
    expect(data.models[0].columns[0]).toEqual({
      name: 'bId',
      type: { pack: 'pg', type: 'uuid' },
      nullable: true,
      map: 'b',
    })
    expect(data.models[0].indexes).toEqual([{ columns: ['bId'], unique: false, name: 'A_b_idx' }])
  })

  test("a relationship's spelled-out isIndexed: true is a genuine duplicate", () => {
    expect(() =>
      single({
        A: {
          fields: { b: relationship({ ref: 'B', isIndexed: true }) },
          db: { indexes: [{ fields: ['b'] }] },
        },
        B: b,
      }),
    ).toThrow(/field "b"'s isIndexed: true — both would emit an index on "bId"/)
  })

  test("a one-to-one's implicit unique yields to a unique entry; a plain entry on it is refused", () => {
    const lists = (index: { fields: string[]; unique?: boolean; name?: string }) => ({
      User: { fields: { profile: relationship({ ref: 'Profile.user' }) } },
      Profile: {
        fields: { user: relationship({ ref: 'User.profile', db: { foreignKey: true } }) },
        db: { indexes: [index] },
      },
    })
    const data = single(lists({ fields: ['user'], unique: true, name: 'Profile_user_key' }))
    const profile = data.models[1]
    expect(profile.columns[0]).toEqual({
      name: 'userId',
      type: { pack: 'pg', type: 'uuid' },
      nullable: true,
      map: 'user',
    })
    expect(profile.indexes).toEqual([
      { columns: ['userId'], unique: true, name: 'Profile_user_key' },
    ])
    expect(profile.relations[0]).toMatchObject({ kind: 'belongsTo', oneToOne: true })

    expect(() => single(lists({ fields: ['user'] }))).toThrow(
      /names field "user", the owning side of the one-to-one with "User\.profile", whose column "userId" already carries the unique constraint/,
    )
    expect(() => single(lists({ fields: ['user'] }))).not.toThrow(/isIndexed/)
  })

  test("a one-to-one owner's spelled-out isIndexed: 'unique' is a genuine duplicate", () => {
    expect(() =>
      single({
        User: { fields: { profile: relationship({ ref: 'Profile.user' }) } },
        Profile: {
          fields: {
            user: relationship({
              ref: 'User.profile',
              isIndexed: 'unique',
              db: { foreignKey: true },
            }),
          },
          db: { indexes: [{ fields: ['user'], unique: true }] },
        },
      }),
    ).toThrow(/field "user"'s isIndexed: 'unique' — both would emit an index on "userId"/)
  })
})
