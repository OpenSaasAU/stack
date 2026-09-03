import { describe, expect, test } from 'vitest'
import pgvector from '@prisma/orm-extension-pgvector/pack'
import {
  assertRelationGraphAgrees,
  buildPrismaContract,
  deriveContract,
  RelationGraphDivergenceError,
  toEmittedContract,
  type ContractData,
  type EmittedContract,
} from '../src/contract/index.js'
import {
  authConfig,
  blogConfig,
  multiSchemaConfig,
  nativeTypesConfig,
  oneToOneConfig,
  ragConfig,
} from './fixtures/contract-configs.js'
import { relationship, text } from '../src/fields/index.js'
import type { OpenSaasConfig } from '../src/config/types.js'

function model(data: ContractData, name: string) {
  const found = data.models.find((m) => m.name === name)
  if (!found) throw new Error(`no model ${name}`)
  return found
}

function table(emitted: EmittedContract, name: string) {
  const found = emitted.storage.namespaces.public.entries.table[name]
  if (!found) throw new Error(`no table ${name}`)
  return found
}

function emittedModel(emitted: EmittedContract, name: string) {
  const found = emitted.domain.namespaces.public.models[name]
  if (!found) throw new Error(`no emitted model ${name}`)
  return found
}

describe('deriveContract + buildPrismaContract — the fixtures yield a valid contract', () => {
  test('blog: ids by strategy, the singleton id, temporal timestamps, the synthetic back-relation', () => {
    const data = deriveContract(blogConfig)
    const emitted = toEmittedContract(buildPrismaContract(data))

    expect(model(data, 'Settings').id).toEqual({
      strategy: 'singleton',
      type: { pack: 'pg', type: 'int' },
    })
    expect(table(emitted, 'Settings').columns.id).toMatchObject({
      nativeType: 'int4',
      default: { kind: 'literal', value: 1 },
    })
    expect(table(emitted, 'Settings').primaryKey).toEqual({ columns: ['id'] })

    expect(model(data, 'User').id).toEqual({
      strategy: 'uuid7',
      type: { pack: 'pg', type: 'uuid' },
    })
    expect(table(emitted, 'User').columns.id).toMatchObject({ nativeType: 'uuid', nullable: false })
    expect(emitted.execution.mutations.defaults).toContainEqual({
      ref: { namespace: 'public', table: 'User', column: 'id' },
      onCreate: { kind: 'generator', id: 'uuidv7' },
    })

    expect(model(data, 'User').timestamps).toEqual({ createdAt: true, updatedAt: true })
    expect(model(data, 'Category').timestamps).toEqual({ createdAt: false, updatedAt: false })
    expect(table(emitted, 'User').columns.createdAt).toMatchObject({
      codecId: 'pg/timestamptz-string@1',
      default: { kind: 'function', expression: 'now()' },
    })
    expect(table(emitted, 'User').columns.updatedAt).toMatchObject({
      codecId: 'pg/timestamptz-string@1',
      nullable: false,
    })
    expect(table(emitted, 'User').columns.updatedAt).not.toHaveProperty('default')
    expect(emitted.execution.mutations.defaults).toContainEqual({
      ref: { namespace: 'public', table: 'User', column: 'updatedAt' },
      onCreate: { kind: 'generator', id: 'timestampNow' },
      onUpdate: { kind: 'generator', id: 'timestampNow' },
    })

    expect(model(data, 'Post').relations).toEqual([
      {
        name: 'author',
        target: 'User',
        kind: 'belongsTo',
        column: 'authorId',
        oneToOne: false,
        synthetic: false,
      },
      {
        name: 'category',
        target: 'Category',
        kind: 'belongsTo',
        column: 'categoryId',
        oneToOne: false,
        synthetic: false,
      },
    ])
    expect(model(data, 'Category').relations).toEqual([
      {
        name: 'from_Post_category',
        target: 'Post',
        kind: 'hasMany',
        column: 'categoryId',
        oneToOne: false,
        synthetic: true,
      },
    ])
    expect(emittedModel(emitted, 'Category').relations.from_Post_category).toEqual({
      to: { namespace: 'public', model: 'Post' },
      cardinality: '1:N',
      on: { localFields: ['id'], targetFields: ['categoryId'] },
    })

    expect(model(data, 'Post').foreignKeys).toEqual([
      { column: 'authorId', references: { model: 'User', column: 'id' }, onDelete: 'setNull' },
      { column: 'categoryId', references: { model: 'Category', column: 'id' } },
    ])
    expect(table(emitted, 'Post').foreignKeys).toEqual([
      {
        source: { namespaceId: 'public', tableName: 'Post', columns: ['author'] },
        target: { namespaceId: 'public', tableName: 'User', columns: ['id'] },
        onDelete: 'setNull',
      },
      {
        source: { namespaceId: 'public', tableName: 'Post', columns: ['category'] },
        target: { namespaceId: 'public', tableName: 'Category', columns: ['id'] },
      },
    ])
    expect(table(emitted, 'Post').columns.author).toMatchObject({
      nativeType: 'uuid',
      nullable: true,
    })

    expect(model(data, 'Post').indexes).toEqual([
      { columns: ['authorId', 'status'], unique: false, name: 'post_author_status' },
    ])
    expect(table(emitted, 'Post').indexes.map((index) => index.columns)).toEqual([
      ['title'],
      ['author'],
      ['category'],
      ['author', 'status'],
    ])
    expect(table(emitted, 'Post').indexes[3]).toMatchObject({ name: 'post_author_status' })
    expect(table(emitted, 'Post').indexes[3]).not.toHaveProperty('prefix')
    expect(table(emitted, 'Post').uniques).toEqual([{ columns: ['slug'] }])
    expect(table(emitted, 'User').uniques).toEqual([{ columns: ['email'] }])

    expect(data.enums).toEqual([{ name: 'PostStatus', values: ['draft', 'published'] }])
    expect(table(emitted, 'Post').columns.status).toMatchObject({
      nativeType: 'PostStatus',
      default: { kind: 'literal', value: 'draft' },
    })
    expect(table(emitted, 'Post').columns.publish_date).toMatchObject({ nativeType: 'date' })

    assertRelationGraphAgrees(data, emitted)
  })

  test('auth: mapped tables, cascading non-null foreign keys, a named unique entry', () => {
    const data = deriveContract(authConfig)
    const emitted = toEmittedContract(buildPrismaContract(data))

    expect(model(data, 'Session').columns.find((column) => column.name === 'userId')).toEqual({
      name: 'userId',
      type: { pack: 'pg', type: 'uuid' },
      nullable: false,
      index: true,
    })
    expect(model(data, 'Session').foreignKeys).toEqual([
      { column: 'userId', references: { model: 'User', column: 'id' }, onDelete: 'cascade' },
    ])
    expect(table(emitted, 'session').foreignKeys[0]).toMatchObject({
      source: { tableName: 'session', columns: ['userId'] },
      target: { tableName: 'user', columns: ['id'] },
      onDelete: 'cascade',
    })
    expect(table(emitted, 'session').indexes.map((index) => index.columns)).toEqual([['userId']])
    expect(table(emitted, 'session').uniques).toEqual([{ columns: ['token'] }])

    expect(model(data, 'RateLimit').indexes).toEqual([
      { columns: ['key'], unique: true, name: 'RateLimit_key_key' },
    ])
    expect(table(emitted, 'rateLimit').uniques).toEqual([
      { columns: ['key'], name: 'RateLimit_key_key' },
    ])
    expect(table(emitted, 'rateLimit').columns.lastRequest).toMatchObject({ nativeType: 'int8' })

    expect(emittedModel(emitted, 'User').relations).toEqual({
      sessions: {
        to: { namespace: 'public', model: 'Session' },
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['userId'] },
      },
      accounts: {
        to: { namespace: 'public', model: 'Account' },
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['userId'] },
      },
    })

    assertRelationGraphAgrees(data, emitted)
  })

  test('RAG: an extension-typed column declares its pack and lowers to the pack constructor', () => {
    const data = deriveContract(ragConfig)
    expect(data.extensions).toEqual([{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }])
    expect(model(data, 'Document').columns.find((column) => column.name === 'embedding')).toEqual({
      name: 'embedding',
      type: { pack: 'pgvector', type: 'Vector', args: [3] },
      nullable: true,
    })

    const emitted = toEmittedContract(buildPrismaContract(data, { packs: { pgvector } }))
    expect(table(emitted, 'Document').columns.embedding).toEqual({
      nativeType: 'vector',
      codecId: 'pg/vector@1',
      nullable: true,
      typeParams: { length: 3 },
    })
    expect(Object.keys(emitted.extensions ?? {})).toEqual(['pgvector'])

    assertRelationGraphAgrees(data, emitted)
  })

  test('RAG: a declared pack that is not passed to the builder is an error naming it', () => {
    expect(() => buildPrismaContract(deriveContract(ragConfig))).toThrow(
      /Extension pack "pgvector" \(from "@prisma\/orm-extension-pgvector"\)/,
    )
  })
})

describe('one-to-one — the owner emits the FK column, constraint and unique; the inverse emits hasOne', () => {
  const data = deriveContract(oneToOneConfig)
  const emitted = toEmittedContract(buildPrismaContract(data))

  test('explicit db.foreignKey: Profile.user owns, User.profile is hasOne', () => {
    expect(model(data, 'Profile').relations).toEqual([
      {
        name: 'user',
        target: 'User',
        kind: 'belongsTo',
        column: 'userId',
        oneToOne: true,
        synthetic: false,
      },
    ])
    expect(model(data, 'Profile').columns.find((column) => column.name === 'userId')).toEqual({
      name: 'userId',
      type: { pack: 'pg', type: 'int' },
      nullable: false,
      map: 'user',
      unique: true,
    })
    expect(model(data, 'Profile').foreignKeys).toEqual([
      {
        column: 'userId',
        references: { model: 'User', column: 'id' },
        onDelete: 'cascade',
        onUpdate: 'cascade',
      },
    ])
    expect(table(emitted, 'Profile').foreignKeys).toEqual([
      {
        source: { namespaceId: 'public', tableName: 'Profile', columns: ['user'] },
        target: { namespaceId: 'public', tableName: 'User', columns: ['id'] },
        onDelete: 'cascade',
        onUpdate: 'cascade',
      },
    ])
    expect(model(data, 'User').relations).toEqual([
      {
        name: 'profile',
        target: 'Profile',
        kind: 'hasOne',
        column: 'userId',
        oneToOne: true,
        synthetic: false,
      },
    ])

    expect(table(emitted, 'Profile').uniques).toEqual([{ columns: ['user'] }])
    expect(table(emitted, 'Profile').columns.user).toMatchObject({
      nativeType: 'int4',
      nullable: false,
    })
    expect(emittedModel(emitted, 'User').relations.profile).toEqual({
      to: { namespace: 'public', model: 'Profile' },
      cardinality: '1:1',
      on: { localFields: ['id'], targetFields: ['userId'] },
    })
    expect(emittedModel(emitted, 'Profile').relations.user).toMatchObject({ cardinality: 'N:1' })
  })

  test('alphabetical default: Passport sorts before Person, so Passport.holder owns', () => {
    expect(model(data, 'Passport').relations).toEqual([
      {
        name: 'holder',
        target: 'Person',
        kind: 'belongsTo',
        column: 'holderId',
        oneToOne: true,
        synthetic: false,
      },
    ])
    expect(model(data, 'Person').relations).toContainEqual({
      name: 'passport',
      target: 'Passport',
      kind: 'hasOne',
      column: 'holderId',
      oneToOne: true,
      synthetic: false,
    })
    expect(table(emitted, 'Passport').uniques).toEqual([
      { columns: ['number'] },
      { columns: ['holder'] },
    ])
    expect(table(emitted, 'Passport').columns.holder).toMatchObject({
      codecId: 'sql/char@1',
      typeParams: { length: 24 },
      nullable: true,
    })
  })

  test('self-referential pair: partner sorts before spouse, so Person.partner owns', () => {
    expect(model(data, 'Person').relations).toContainEqual({
      name: 'partner',
      target: 'Person',
      kind: 'belongsTo',
      column: 'partnerId',
      oneToOne: true,
      synthetic: false,
    })
    expect(model(data, 'Person').relations).toContainEqual({
      name: 'spouse',
      target: 'Person',
      kind: 'hasOne',
      column: 'partnerId',
      oneToOne: true,
      synthetic: false,
    })
    expect(table(emitted, 'Person').uniques).toEqual([{ columns: ['partner'] }])
    expect(table(emitted, 'Person').foreignKeys).toContainEqual({
      source: { namespaceId: 'public', tableName: 'Person', columns: ['partner'] },
      target: { namespaceId: 'public', tableName: 'Person', columns: ['id'] },
    })
    expect(emittedModel(emitted, 'Person').relations.spouse).toEqual({
      to: { namespace: 'public', model: 'Person' },
      cardinality: '1:1',
      on: { localFields: ['id'], targetFields: ['partnerId'] },
    })
  })

  test('every list derives its own db.idField over the config default', () => {
    expect(model(data, 'User').id.strategy).toBe('int autoincrement')
    expect(model(data, 'Profile').id.strategy).toBe('cuid2')
    expect(table(emitted, 'User').columns.id).toMatchObject({
      nativeType: 'int4',
      default: { kind: 'function', expression: 'autoincrement()' },
    })
    expect(table(emitted, 'Profile').columns.id).toMatchObject({ codecId: 'sql/char@1' })
    expect(emitted.execution.mutations.defaults).toContainEqual({
      ref: { namespace: 'public', table: 'Profile', column: 'id' },
      onCreate: { kind: 'generator', id: 'cuid2' },
    })
  })

  test('the relation graph agrees with the emitted contract', () => {
    expect(() => assertRelationGraphAgrees(data, emitted)).not.toThrow()
  })
})

describe('one-to-one — a named unique db.indexes entry on the owning column names the implicit constraint', () => {
  const config: OpenSaasConfig = {
    db: { provider: 'postgresql' },
    lists: {
      User: { fields: { profile: relationship({ ref: 'Profile.user' }) } },
      Profile: {
        fields: {
          bio: text(),
          user: relationship({ ref: 'User.profile', db: { foreignKey: true } }),
        },
        db: { indexes: [{ fields: ['user'], unique: true, name: 'Profile_user_key' }] },
      },
    },
  }
  const data = deriveContract(config)
  const emitted = toEmittedContract(buildPrismaContract(data))

  test('one unique constraint carries the entry name; the column drops its own', () => {
    expect(model(data, 'Profile').columns.find((column) => column.name === 'userId')).toEqual({
      name: 'userId',
      type: { pack: 'pg', type: 'uuid' },
      nullable: true,
      map: 'user',
    })
    expect(model(data, 'Profile').indexes).toEqual([
      { columns: ['userId'], unique: true, name: 'Profile_user_key' },
    ])
    expect(table(emitted, 'Profile').uniques).toEqual([
      { columns: ['user'], name: 'Profile_user_key' },
    ])
    expect(() => assertRelationGraphAgrees(data, emitted)).not.toThrow()
  })
})

describe('multi-schema — db.schemas and db.schema place a model in its namespace', () => {
  const data = deriveContract(multiSchemaConfig)
  const emitted = toEmittedContract(buildPrismaContract(data))

  test('the namespaces beyond public are declared and the model lands in its own', () => {
    expect(data.namespaces).toEqual(['auth'])
    expect(model(data, 'Session').namespace).toBe('auth')
    expect(Object.keys(emitted.storage.namespaces).sort()).toEqual(['auth', 'public'])
    expect(emitted.storage.namespaces.auth.entries.table.session).toBeDefined()
    expect(emitted.storage.namespaces.public.entries.table.User).toBeDefined()
    expect(emitted.domain.namespaces.auth.models.Session.storage).toMatchObject({
      table: 'session',
      namespaceId: 'auth',
    })
    expect(emitted.domain.namespaces.auth.models.Session.relations.user).toEqual({
      to: { namespace: 'public', model: 'User' },
      cardinality: 'N:1',
      on: { localFields: ['userId'], targetFields: ['id'] },
    })
    expect(emitted.domain.namespaces.public.models.User.relations.sessions).toEqual({
      to: { namespace: 'auth', model: 'Session' },
      cardinality: '1:N',
      on: { localFields: ['id'], targetFields: ['userId'] },
    })
    expect(() => assertRelationGraphAgrees(data, emitted)).not.toThrow()
  })

  test('a relation whose emitted target sits in another namespace is a divergence', () => {
    const seeded = toEmittedContract(buildPrismaContract(data))
    seeded.domain.namespaces.public.models.User.relations.sessions.to.namespace = 'public'
    expect(() => assertRelationGraphAgrees(data, seeded)).toThrow(RelationGraphDivergenceError)
    expect(() => assertRelationGraphAgrees(data, seeded)).toThrow(
      /at User\.sessions: the config places "Session" in namespace "auth" but the emitted relation targets it in "public"/,
    )
  })
})

describe('native types — every honoured db.nativeType lowers to its own column', () => {
  const data = deriveContract(nativeTypesConfig)
  const emitted = toEmittedContract(buildPrismaContract(data))
  const columns = table(emitted, 'Reading').columns

  test('the derived descriptors carry the constructor and its arguments', () => {
    expect(Object.fromEntries(model(data, 'Reading').columns.map((c) => [c.name, c.type]))).toEqual(
      {
        code: { pack: 'pg', type: 'varchar', args: [255] },
        tag: { pack: 'pg', type: 'char', args: [3] },
        amount: { pack: 'pg', type: 'decimal', args: [10, 2] },
        ratio: { pack: 'pg', type: 'real' },
        raw: { pack: 'pg', type: 'json' },
        doc: { pack: 'pg', type: 'jsonb' },
        takenAt: { pack: 'pg', type: 'timestamp', args: [3] },
        seenAt: { pack: 'pg', type: 'timestamptz', args: [6] },
        atTime: { pack: 'pg', type: 'time', args: [2] },
        day: { pack: 'pg', type: 'date' },
      },
    )
  })

  test('the built contract binds each to its native type, codec and type params', () => {
    expect(columns.code).toMatchObject({
      nativeType: 'character varying',
      typeParams: { length: 255 },
    })
    expect(columns.tag).toMatchObject({ nativeType: 'character', typeParams: { length: 3 } })
    expect(columns.amount).toMatchObject({
      nativeType: 'numeric',
      typeParams: { precision: 10, scale: 2 },
    })
    expect(columns.ratio).toMatchObject({ nativeType: 'float4', codecId: 'pg/float4@1' })
    expect(columns.raw).toMatchObject({ nativeType: 'json', codecId: 'pg/json@1' })
    expect(columns.doc).toMatchObject({ nativeType: 'jsonb', codecId: 'pg/jsonb@1' })
    expect(columns.takenAt).toMatchObject({
      nativeType: 'timestamp',
      codecId: 'pg/timestamp-string@1',
      typeParams: { precision: 3 },
    })
    expect(columns.seenAt).toMatchObject({
      nativeType: 'timestamptz',
      codecId: 'pg/timestamptz-string@1',
      typeParams: { precision: 6 },
    })
    expect(columns.atTime).toMatchObject({
      nativeType: 'time',
      codecId: 'pg/time-string@1',
      typeParams: { precision: 2 },
    })
    expect(columns.day).toMatchObject({ nativeType: 'date', codecId: 'pg/date-string@1' })
  })
})

describe('assertRelationGraphAgrees — a seeded divergence fails naming the relation', () => {
  const data = deriveContract(oneToOneConfig)

  function seeded(mutate: (emitted: EmittedContract) => void): EmittedContract {
    const emitted = toEmittedContract(buildPrismaContract(data))
    mutate(emitted)
    return emitted
  }

  test('a dropped unique constraint on the owning column', () => {
    const emitted = seeded((e) => {
      e.storage.namespaces.public.entries.table.Profile.uniques = []
    })
    expect(() => assertRelationGraphAgrees(data, emitted)).toThrow(RelationGraphDivergenceError)
    expect(() => assertRelationGraphAgrees(data, emitted)).toThrow(
      /at User\.profile: .*no unique constraint on "userId"/,
    )
  })

  test('a flipped cardinality', () => {
    const emitted = seeded((e) => {
      e.domain.namespaces.public.models.User.relations.profile.cardinality = '1:N'
    })
    expect(() => assertRelationGraphAgrees(data, emitted)).toThrow(
      /at User\.profile: the config derives hasOne \(1:1\) but the emitted cardinality is "1:N"/,
    )
  })

  test('a relation the config did not derive', () => {
    const emitted = seeded((e) => {
      e.domain.namespaces.public.models.Person.relations.friends = {
        to: { namespace: 'public', model: 'Person' },
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['partnerId'] },
      }
    })
    expect(() => assertRelationGraphAgrees(data, emitted)).toThrow(
      /at Person\.friends: the emitted contract carries a relation the config did not derive/,
    )
  })

  test('a missing relation and a retargeted one', () => {
    expect(() =>
      assertRelationGraphAgrees(
        data,
        seeded((e) => {
          delete e.domain.namespaces.public.models.Passport.relations.holder
        }),
      ),
    ).toThrow(/at Passport\.holder: the relation is missing/)
    expect(() =>
      assertRelationGraphAgrees(
        data,
        seeded((e) => {
          e.domain.namespaces.public.models.Passport.relations.holder.to.model = 'User'
        }),
      ),
    ).toThrow(
      /at Passport\.holder: the config targets "Person" but the emitted relation targets "User"/,
    )
  })

  test('a missing model and a re-keyed relation', () => {
    expect(() =>
      assertRelationGraphAgrees(
        data,
        seeded((e) => {
          delete e.domain.namespaces.public.models.Passport
        }),
      ),
    ).toThrow(/at Passport: the model is missing/)
    expect(() =>
      assertRelationGraphAgrees(
        data,
        seeded((e) => {
          e.domain.namespaces.public.models.Person.relations.spouse.on.targetFields = ['spouseId']
        }),
      ),
    ).toThrow(/at Person\.spouse: the config keys it on \[id\] → \[partnerId\]/)
  })
})
