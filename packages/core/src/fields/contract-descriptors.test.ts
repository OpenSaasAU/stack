import { describe, test, expect } from 'vitest'
import {
  text,
  integer,
  decimal,
  bigInt,
  checkbox,
  timestamp,
  calendarDay,
  password,
  select,
  relationship,
  json,
  virtual,
} from './index.js'
import type { OpenSaasConfig } from '../config/types.js'

const userPosts = relationship({ ref: 'Post.author', many: true })
const userProfile = relationship({ ref: 'Profile.user' })
const postAuthor = relationship({ ref: 'User.posts' })
const postCategory = relationship({ ref: 'Category', db: { foreignKey: { map: 'category_id' } } })
const postTags = relationship({ ref: 'Tag', many: true })
const profileUser = relationship({
  ref: 'User.profile',
  db: { foreignKey: true, isNullable: false },
})

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    User: { fields: { name: text(), posts: userPosts, profile: userProfile } },
    Post: { fields: { author: postAuthor, category: postCategory, tags: postTags } },
    Profile: { fields: { user: profileUser } },
    Category: { fields: { name: text() } },
    Tag: { fields: { name: text() } },
  },
}

describe('getContractField — every core builder describes its contract contribution', () => {
  test('text: a nullable pg text column by default', () => {
    expect(text().getContractField?.('title', 'Post', config)).toEqual({
      kind: 'column',
      name: 'title',
      type: { pack: 'pg', type: 'text' },
      nullable: true,
    })
  })

  test('text: required, indexed, mapped, native-typed and defaulted', () => {
    expect(
      text({
        validation: { isRequired: true },
        isIndexed: 'unique',
        defaultValue: 'untitled',
        db: { map: 'post_title', nativeType: 'VarChar(255)' },
      }).getContractField?.('title', 'Post', config),
    ).toEqual({
      kind: 'column',
      name: 'title',
      type: { pack: 'pg', type: 'text' },
      nativeType: 'VarChar(255)',
      nullable: false,
      map: 'post_title',
      unique: true,
      default: { kind: 'literal', value: 'untitled' },
    })
  })

  test('text: db.isNullable overrides validation.isRequired, and isIndexed: true is a non-unique index', () => {
    expect(
      text({
        validation: { isRequired: true },
        db: { isNullable: true },
        isIndexed: true,
      }).getContractField?.('slug', 'Post', config),
    ).toMatchObject({ nullable: true, index: true })
  })

  test('integer: pg int with a numeric default', () => {
    expect(
      integer({ validation: { isRequired: true }, defaultValue: 0 }).getContractField?.(
        'views',
        'Post',
        config,
      ),
    ).toEqual({
      kind: 'column',
      name: 'views',
      type: { pack: 'pg', type: 'int' },
      nullable: false,
      default: { kind: 'literal', value: 0 },
    })
  })

  test('decimal: precision and scale are the type constructor arguments', () => {
    expect(decimal().getContractField?.('price', 'Product', config)).toEqual({
      kind: 'column',
      name: 'price',
      type: { pack: 'pg', type: 'decimal', args: [18, 4] },
      nullable: true,
    })
    // getPrismaType always emits @db.Decimal(p, s) and ignores db.nativeType;
    // the descriptor carries the args only, never a second, competing native type.
    expect(
      decimal({ db: { nativeType: 'Money' } }).getContractField?.('price', 'Product', config),
    ).toEqual({
      kind: 'column',
      name: 'price',
      type: { pack: 'pg', type: 'decimal', args: [18, 4] },
      nullable: true,
    })
    expect(
      decimal({ precision: 10, scale: 2, defaultValue: '0.00' }).getContractField?.(
        'price',
        'Product',
        config,
      ),
    ).toMatchObject({
      type: { pack: 'pg', type: 'decimal', args: [10, 2] },
      default: { kind: 'literal', value: '0.00' },
    })
  })

  test('bigInt: pg bigint; 42n, 42 and "42" defaults all carry the one decimal string', () => {
    for (const defaultValue of [42n, 42, '42']) {
      expect(bigInt({ defaultValue }).getContractField?.('epoch', 'Event', config)).toEqual({
        kind: 'column',
        name: 'epoch',
        type: { pack: 'pg', type: 'bigint' },
        nullable: true,
        default: { kind: 'literal', value: '42' },
      })
    }
  })

  test('checkbox: non-nullable unless db.isNullable is true', () => {
    expect(checkbox({ defaultValue: false }).getContractField?.('done', 'Task', config)).toEqual({
      kind: 'column',
      name: 'done',
      type: { pack: 'pg', type: 'boolean' },
      nullable: false,
      default: { kind: 'literal', value: false },
    })
    expect(
      checkbox({ db: { isNullable: true } }).getContractField?.('done', 'Task', config),
    ).toMatchObject({ nullable: true })
    // getPrismaType never emits @db.* for a checkbox, so neither does the descriptor.
    expect(
      checkbox({ db: { nativeType: 'Bit(1)' } }).getContractField?.('done', 'Task', config),
    ).toEqual({
      kind: 'column',
      name: 'done',
      type: { pack: 'pg', type: 'boolean' },
      nullable: false,
    })
  })

  test('timestamp: { kind: "now" } is a database-clock default and makes the column non-nullable', () => {
    expect(
      timestamp({ defaultValue: { kind: 'now' } }).getContractField?.(
        'publishedAt',
        'Post',
        config,
      ),
    ).toEqual({
      kind: 'column',
      name: 'publishedAt',
      type: { pack: 'pg', type: 'dateTime' },
      nullable: false,
      default: { kind: 'now' },
    })
  })

  test('timestamp: a Date default carries no default, matching getPrismaType; null and absence leave the column nullable', () => {
    const noDefault = {
      kind: 'column',
      name: 'publishedAt',
      type: { pack: 'pg', type: 'dateTime' },
      nullable: true,
    }
    const dated = timestamp({ defaultValue: new Date('2024-01-01T00:00:00.000Z') })
    expect(dated.getPrismaType?.('publishedAt').modifiers).toBe('?')
    expect(dated.getContractField?.('publishedAt', 'Post', config)).toEqual(noDefault)
    const nulled = timestamp({
      // @ts-expect-error — a plain-JS config can spell "no default" as null
      defaultValue: null,
    })
    expect(nulled.getContractField?.('publishedAt', 'Post', config)).toEqual(noDefault)
    expect(timestamp().getContractField?.('publishedAt', 'Post', config)).toEqual(noDefault)
  })

  test('calendarDay: a date-typed column with a string TypeScript face on both sides', () => {
    const field = calendarDay({ validation: { isRequired: true }, defaultValue: '2025-01-01' })
    expect(field.getContractField?.('birthDate', 'Person', config)).toEqual({
      kind: 'column',
      name: 'birthDate',
      type: { pack: 'pg', type: 'dateTime' },
      nativeType: 'date',
      nullable: false,
      default: { kind: 'literal', value: '2025-01-01' },
    })
    expect(field.outputType).toBe('string')
    expect(field.inputType).toBe('string')
  })

  test('password: a text column whose read type is HashedPassword', () => {
    const field = password({ validation: { isRequired: true } })
    expect(field.getContractField?.('password', 'User', config)).toEqual({
      kind: 'column',
      name: 'password',
      type: { pack: 'pg', type: 'text' },
      nullable: false,
    })
    expect(field.outputType).toBe("import('@opensaas/stack-core/internal').HashedPassword")
    expect(field.inputType).toBeUndefined()
  })

  test('select (string): a text column; a default makes it non-nullable; the TypeScript face is the option union', () => {
    const field = select({
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
      ],
      defaultValue: 'draft',
    })
    expect(field.getContractField?.('status', 'Post', config)).toEqual({
      kind: 'column',
      name: 'status',
      type: { pack: 'pg', type: 'text' },
      nullable: false,
      default: { kind: 'literal', value: 'draft' },
    })
    expect(field.outputType).toBe("'draft' | 'published'")
    expect(field.inputType).toBe("'draft' | 'published'")
  })

  test('select (enum): an enum column naming its native enum, derived from list and field', () => {
    expect(
      select({
        options: [
          { label: 'Open', value: 'open' },
          { label: 'Closed', value: 'closed' },
        ],
        db: { type: 'enum' },
      }).getContractField?.('status', 'Ticket', config),
    ).toEqual({
      kind: 'column',
      name: 'status',
      type: { pack: 'pg', type: 'enum' },
      nullable: true,
      enum: { name: 'TicketStatus', values: ['open', 'closed'] },
    })
  })

  test('select (enum): db.enumName overrides the derived name; db.isNullable overrides the default rule', () => {
    expect(
      select({
        options: [{ label: 'Open', value: 'open' }],
        defaultValue: 'open',
        db: { type: 'enum', enumName: 'TicketStatusType', isNullable: true },
      }).getContractField?.('status', 'Ticket', config),
    ).toMatchObject({ nullable: true, enum: { name: 'TicketStatusType' } })
  })

  test('json: a pg json column; an object default is carried as a literal', () => {
    expect(
      json({ defaultValue: { theme: 'dark', tags: [] } }).getContractField?.(
        'settings',
        'User',
        config,
      ),
    ).toEqual({
      kind: 'column',
      name: 'settings',
      type: { pack: 'pg', type: 'json' },
      nullable: true,
      default: { kind: 'literal', value: { theme: 'dark', tags: [] } },
    })
  })

  test('a default that is not a JSON literal is refused, naming the list and field', () => {
    expect(() =>
      json({ defaultValue: new Date(0) }).getContractField?.('meta', 'Post', config),
    ).toThrow('"Post.meta" has a defaultValue the contract cannot carry')
    expect(() =>
      json({ defaultValue: new Date(0) }).getContractField?.('meta', 'Post', config),
    ).toThrow('an instance of Date')
    expect(() =>
      json({ defaultValue: { tags: new Map() } }).getContractField?.('meta', 'Post', config),
    ).toThrow('"Post.meta"')
    expect(() =>
      json({ defaultValue: () => 1 }).getContractField?.('meta', 'Post', config),
    ).toThrow('a function')
    expect(
      json({ defaultValue: [1, 'two', null, { three: true }] }).getContractField?.(
        'meta',
        'Post',
        config,
      ),
    ).toMatchObject({ default: { kind: 'literal', value: [1, 'two', null, { three: true }] } })
  })

  test('a caller-supplied outputType/inputType wins over the builder default', () => {
    const status = select({
      options: [{ label: 'Open', value: 'open' }],
      outputType: 'Status',
      inputType: 'StatusInput',
    })
    expect(status.outputType).toBe('Status')
    expect(status.inputType).toBe('StatusInput')
    expect(password({ outputType: 'string' }).outputType).toBe('string')
    expect(calendarDay({ outputType: 'Date' }).outputType).toBe('Date')
    expect(calendarDay().inputType).toBe('string')
  })

  test('virtual: no storage; its outputType is the type it was declared with', () => {
    const field = virtual({ type: 'string', hooks: { resolveOutput: () => 'x' } })
    expect(field.getContractField?.('fullName', 'User', config)).toEqual({ kind: 'computed' })
    expect(field.outputType).toBe('string')
  })

  test('virtual: a type descriptor object keeps its import spelling', () => {
    class Money {}
    const field = virtual({
      type: { value: Money, from: '@acme/money' },
      hooks: { resolveOutput: () => new Money() },
    })
    expect(field.outputType).toBe("import('@acme/money').Money")
  })

  test('relationship (to-one, bidirectional): owns an indexed, nullable foreign key mapped to the field name', () => {
    const field = postAuthor
    expect(field.getContractField?.('author', 'Post', config)).toEqual({
      kind: 'relation',
      target: 'User',
      inverse: { field: 'posts', synthetic: false },
      many: false,
      foreignKey: {
        name: 'authorId',
        map: 'author',
        nullable: true,
        unique: false,
        index: true,
        references: { list: 'User', field: 'id' },
      },
    })
  })

  test('relationship (to-many): the relation only, no column', () => {
    const field = userPosts
    expect(field.getContractField?.('posts', 'User', config)).toEqual({
      kind: 'relation',
      target: 'Post',
      inverse: { field: 'author', synthetic: false },
      many: true,
    })
  })

  test('relationship (list-only ref): the inverse is synthetic and db.foreignKey.map renames the column', () => {
    expect(postCategory.getContractField?.('category', 'Post', config)).toEqual({
      kind: 'relation',
      target: 'Category',
      inverse: { field: 'from_Post_category', synthetic: true },
      many: false,
      foreignKey: {
        name: 'categoryId',
        map: 'category_id',
        nullable: true,
        unique: false,
        index: true,
        references: { list: 'Category', field: 'id' },
      },
    })
    expect(postTags.getContractField?.('tags', 'Post', config)).toEqual({
      kind: 'relation',
      target: 'Tag',
      inverse: { field: 'from_Post_tags', synthetic: true },
      many: true,
    })
  })

  test('relationship (one-to-one): the owning side has a unique, non-nullable foreign key; the other side has none', () => {
    expect(profileUser.getContractField?.('user', 'Profile', config)).toEqual({
      kind: 'relation',
      target: 'User',
      inverse: { field: 'profile', synthetic: false },
      many: false,
      foreignKey: {
        name: 'userId',
        map: 'user',
        nullable: false,
        unique: true,
        index: true,
        references: { list: 'User', field: 'id' },
      },
    })
    expect(userProfile.getContractField?.('profile', 'User', config)).toEqual({
      kind: 'relation',
      target: 'Profile',
      inverse: { field: 'user', synthetic: false },
      many: false,
    })
  })

  test('relationship: isIndexed false drops the index, "unique" makes the foreign key unique', () => {
    expect(
      relationship({ ref: 'User', isIndexed: false }).getContractField?.('owner', 'Post', config),
    ).toMatchObject({ foreignKey: { index: false, unique: false } })
    expect(
      relationship({ ref: 'User', isIndexed: 'unique' }).getContractField?.(
        'owner',
        'Post',
        config,
      ),
    ).toMatchObject({ foreignKey: { index: false, unique: true } })
  })

  test('relationship: db.isNullable on the non-owning side of a one-to-one is refused', () => {
    const nonOwning = relationship({ ref: 'Profile.user', db: { isNullable: false } })
    const misconfigured: OpenSaasConfig = {
      ...config,
      lists: {
        ...config.lists,
        User: { fields: { ...config.lists.User.fields, profile: nonOwning } },
      },
    }
    expect(() => nonOwning.getContractField?.('profile', 'User', misconfigured)).toThrow(
      /does not own the foreign key/,
    )
  })

  test('stored scalars declare no TypeScript face override — the codec type stands', () => {
    for (const field of [text(), integer(), decimal(), bigInt(), checkbox(), timestamp(), json()]) {
      expect(field.outputType).toBeUndefined()
      expect(field.inputType).toBeUndefined()
    }
  })

  test('the PSL-shaped methods still answer beside the descriptor', () => {
    const field = text({ validation: { isRequired: true } })
    expect(field.getPrismaType?.('title')).toEqual({
      type: 'String',
      modifiers: undefined,
      index: undefined,
    })
    expect(field.getTypeScriptType?.()).toEqual({ type: 'string', optional: false })
    expect(postAuthor.getPrismaRelation?.('author', {}, 'Post', config)).toMatchObject({
      foreignKeyField: 'authorId',
    })
  })
})
