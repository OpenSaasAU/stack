import type { BaseFieldConfig, OpenSaasConfig, TypeInfo } from '../../src/config/types.js'
import {
  bigInt,
  calendarDay,
  checkbox,
  decimal,
  integer,
  json,
  password,
  relationship,
  select,
  text,
  timestamp,
  virtual,
} from '../../src/fields/index.js'

/**
 * The blog example, as the Prisma 8 config surface spells it: a singleton,
 * a virtual field, a select enum, a mapped calendar day, a bidirectional
 * one-to-many and a list-only ref (synthetic back-relation).
 */
export const blogConfig: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    Settings: {
      isSingleton: true,
      fields: {
        siteName: text({ validation: { isRequired: true }, defaultValue: 'My Blog' }),
        maintenanceMode: checkbox({ defaultValue: false }),
        maxUploadSize: integer({ defaultValue: 10 }),
      },
    },
    User: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        email: text({ validation: { isRequired: true }, isIndexed: 'unique' }),
        password: password({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.author', many: true }),
        displayName: virtual({
          type: 'string',
          hooks: { resolveOutput: ({ item }) => String(item.name) },
        }),
      },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true }, isIndexed: true }),
        slug: text({ validation: { isRequired: true }, isIndexed: 'unique' }),
        content: text(),
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          defaultValue: 'draft',
          db: { type: 'enum' },
        }),
        publishDate: calendarDay({ db: { map: 'publish_date' } }),
        publishedAt: timestamp(),
        author: relationship({ ref: 'User.posts', db: { onDelete: 'setNull' } }),
        category: relationship({ ref: 'Category' }),
      },
      db: { indexes: [{ fields: ['author', 'status'], name: 'post_author_status' }] },
    },
    Category: {
      fields: { name: text({ validation: { isRequired: true } }) },
      db: { timestamps: false },
    },
  },
}

/**
 * The lists `authPlugin` derives from better-auth's table shapes, mirrored
 * as a plain config: the stack-auth package depends on core, so core's tests
 * cannot import it without a cycle. Field shapes follow
 * `packages/auth/src/config/derive-auth-lists.ts` — mapped, non-nullable,
 * cascading foreign keys; `db.timestamps: true` per list; a named unique
 * `db.indexes` entry on the rate-limit table.
 */
export const authConfig: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    User: {
      fields: {
        name: text({ validation: { isRequired: true }, db: { isNullable: false } }),
        email: text({
          validation: { isRequired: true },
          isIndexed: 'unique',
          db: { isNullable: false },
        }),
        emailVerified: checkbox({ defaultValue: false, db: { isNullable: false } }),
        image: text({ db: { isNullable: true } }),
        sessions: relationship({ ref: 'Session.user', many: true }),
        accounts: relationship({ ref: 'Account.user', many: true }),
      },
      db: { timestamps: true, map: 'user' },
    },
    Session: {
      fields: {
        token: text({
          validation: { isRequired: true },
          isIndexed: 'unique',
          db: { isNullable: false },
        }),
        expiresAt: timestamp({ db: { isNullable: false } }),
        ipAddress: text({ db: { isNullable: true } }),
        userAgent: text({ db: { isNullable: true } }),
        user: relationship({
          ref: 'User.sessions',
          isIndexed: true,
          db: { isNullable: false, foreignKey: { map: 'userId' }, onDelete: 'cascade' },
        }),
      },
      db: { timestamps: true, map: 'session' },
    },
    Account: {
      fields: {
        accountId: text({ validation: { isRequired: true }, db: { isNullable: false } }),
        providerId: text({ validation: { isRequired: true }, db: { isNullable: false } }),
        user: relationship({
          ref: 'User.accounts',
          isIndexed: true,
          db: { isNullable: false, foreignKey: { map: 'userId' }, onDelete: 'cascade' },
        }),
        accessToken: text({ db: { isNullable: true } }),
        refreshToken: text({ db: { isNullable: true } }),
        accessTokenExpiresAt: timestamp({ db: { isNullable: true } }),
        refreshTokenExpiresAt: timestamp({ db: { isNullable: true } }),
        scope: text({ db: { isNullable: true } }),
        idToken: text({ db: { isNullable: true } }),
        password: text({ db: { isNullable: true } }),
      },
      db: { timestamps: true, map: 'account' },
    },
    Verification: {
      fields: {
        identifier: text({
          validation: { isRequired: true },
          isIndexed: true,
          db: { isNullable: false },
        }),
        value: text({ validation: { isRequired: true }, db: { isNullable: false } }),
        expiresAt: timestamp({ db: { isNullable: false } }),
      },
      db: { timestamps: true, map: 'verification' },
    },
    RateLimit: {
      fields: {
        key: text({ db: { isNullable: false } }),
        count: integer({ db: { isNullable: false } }),
        lastRequest: bigInt({ db: { isNullable: false } }),
      },
      db: {
        map: 'rateLimit',
        indexes: [{ fields: ['key'], unique: true, name: 'RateLimit_key_key' }],
      },
    },
  },
}

/**
 * A test-local vector field whose descriptor names the pgvector pack. The
 * RAG package's embedding field itself moves in a later spec; this stands in
 * for any third-party field typed by an extension pack.
 */
export function vector(options: { dimensions: number }): BaseFieldConfig<TypeInfo> {
  return {
    type: 'vector',
    getContractField: (fieldName) => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pgvector', type: 'Vector', args: [options.dimensions] },
      nullable: true,
    }),
  }
}

export const ragConfig: OpenSaasConfig = {
  db: {
    provider: 'postgresql',
    extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
  },
  lists: {
    Document: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        content: text(),
        embedding: vector({ dimensions: 3 }),
      },
    },
  },
}

/**
 * Every ownership case ADR-0064 names: explicit `db.foreignKey: true`
 * (`Profile.user`), the alphabetical default (`Passport` sorts before
 * `Person`, so `Passport.holder` owns), and a self-referential pair on one
 * list (`partner` sorts before `spouse`, so `Person.partner` owns).
 */
export const oneToOneConfig: OpenSaasConfig = {
  db: { provider: 'postgresql', idField: 'cuid2' },
  lists: {
    User: {
      fields: {
        email: text({ isIndexed: 'unique' }),
        profile: relationship({ ref: 'Profile.user' }),
      },
      db: { idField: 'int autoincrement' },
    },
    Profile: {
      fields: {
        bio: text(),
        user: relationship({
          ref: 'User.profile',
          db: { foreignKey: true, isNullable: false, onDelete: 'cascade', onUpdate: 'cascade' },
        }),
      },
    },
    Person: {
      fields: {
        name: text(),
        passport: relationship({ ref: 'Passport.holder' }),
        partner: relationship({ ref: 'Person.spouse' }),
        spouse: relationship({ ref: 'Person.partner' }),
      },
    },
    Passport: {
      fields: {
        number: text({ isIndexed: 'unique' }),
        holder: relationship({ ref: 'Person.passport' }),
      },
    },
  },
}

/**
 * Two Postgres schemas: `db.schemas` declares them, `Session` lives in
 * `auth` and points back at `User` in the default `public`.
 */
export const multiSchemaConfig: OpenSaasConfig = {
  db: { provider: 'postgresql', schemas: ['public', 'auth'] },
  lists: {
    User: {
      fields: {
        email: text({ isIndexed: 'unique' }),
        sessions: relationship({ ref: 'Session.user', many: true }),
      },
    },
    Session: {
      fields: {
        token: text({ isIndexed: 'unique' }),
        user: relationship({ ref: 'User.sessions', db: { isNullable: false } }),
      },
      db: { schema: 'auth', map: 'session' },
    },
  },
}

/**
 * Every `db.nativeType` override the derivation honours, next to the
 * builders' own defaults it overrides.
 */
export const nativeTypesConfig: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Reading: {
      fields: {
        code: text({ db: { nativeType: 'VarChar(255)' } }),
        tag: text({ db: { nativeType: 'Char(3)' } }),
        amount: decimal({ db: { nativeType: 'Decimal(10, 2)' } }),
        ratio: decimal({ db: { nativeType: 'Real' } }),
        raw: json({ db: { nativeType: 'Json' } }),
        doc: json(),
        takenAt: timestamp({ db: { nativeType: 'Timestamp(3)' } }),
        seenAt: timestamp({ db: { nativeType: 'Timestamptz(6)' } }),
        atTime: timestamp({ db: { nativeType: 'Time(2)' } }),
        day: timestamp({ db: { nativeType: 'Date' } }),
      },
    },
  },
}

/**
 * The names and values the renderer has to survive rather than the ones it
 * usually sees: a list called `models` (the record the emitted callback keeps
 * its model tokens in), a list called `StatusEnum` beside an enum called
 * `Status`, a non-identifier field key, a non-identifier index name, and a
 * default carrying a quote, a backslash, every line terminator and non-ASCII
 * text. Nothing here enforces PascalCase or an identifier-shaped field key, so
 * every one of these is reachable from a real config.
 */
export const hostileNamesConfig: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    models: {
      fields: {
        'weird-key': text({
          defaultValue:
            "it's \\ a quote, a backslash,\r\n a CRLF,\u2028 a line separator,\u2029 a paragraph separator \u2014 caf\u00e9 \ud83c\udf10",
        }),
        plain: text(),
      },
      db: {
        map: "weird'table\\name",
        indexes: [{ fields: ['weird-key', 'plain'], name: "weird'index name" }],
      },
    },
    // A model whose name is exactly the enum's, and one whose name is what the
    // enum binding used to be spelled as.
    Status: {
      fields: { label: text() },
    },
    StatusEnum: {
      fields: { label: text() },
    },
    Ticket: {
      fields: {
        state: select({
          options: [
            { label: "It's open", value: 'open' },
            { label: 'Closed', value: 'closed' },
          ],
          defaultValue: 'open',
          db: { type: 'enum', enumName: 'Status' },
        }),
        owner: relationship({ ref: 'models' }),
      },
    },
  },
}
