import type { BaseFieldConfig, OpenSaasConfig, TypeInfo } from '../../src/config/types.js'
import {
  bigInt,
  calendarDay,
  checkbox,
  integer,
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

/** The same lists with the pack left undeclared — the refusal case. */
export const ragConfigWithoutPack: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: ragConfig.lists,
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
          db: { foreignKey: true, isNullable: false, onDelete: 'cascade' },
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
