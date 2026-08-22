/**
 * Pure `better-auth config → Auth lists` derivation, free of side effects and
 * plugin/runtime concerns. See `packages/auth/CLAUDE.md` ("Deriving Auth lists
 * from better-auth config") for the full behavior and examples.
 */

import { list } from '@opensaas/stack-core'
import {
  text,
  timestamp,
  checkbox,
  integer,
  bigInt,
  relationship,
} from '@opensaas/stack-core/fields'
import type { ListConfig } from '@opensaas/stack-core'
import type { RelationshipField } from '@opensaas/stack-core/fields'
import type { ExtendUserListConfig } from '../lists/index.js'
import type { AuthAccessConfig, NormalizedAuthModelConfig, NormalizedAuthModels } from './types.js'

/**
 * The derived Auth list set together with the keys each list was placed under.
 * Keys are surfaced separately so callers (plugin add-vs-extend logic, runtime
 * user-key resolution) don't have to re-derive them.
 */
export type DerivedAuthLists = {
  /** Derived list keys, one per better-auth model. */
  keys: {
    user: string
    session: string
    account: string
    verification: string
    /** Only present when a `RateLimit` list was derived (`rateLimit.storage === 'database'`). */
    rateLimit?: string
  }
  /** The derived list configs, keyed by their derived list keys. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  lists: Record<string, ListConfig<any>>
}

/**
 * Build the list-level `db` config (`timestamps` + `@@map` + `@@schema`) for a
 * derived list.
 *
 * `timestamps` is a per-model input, not hardcoded: better-auth's adapter
 * writes `createdAt`/`updatedAt` on every user/session/account/verification
 * row, so those four opt back into auto-timestamps now that they're OFF by
 * default (ADR-0004). The `RateLimit` model has neither column upstream, so
 * it passes `false`.
 */
function listDb(
  model: NormalizedAuthModelConfig,
  timestamps: boolean,
): { timestamps?: true; map?: string; schema?: string } {
  const schema = model.schema
  return {
    ...(timestamps ? { timestamps: true as const } : {}),
    ...(model.tableName !== undefined ? { map: model.tableName } : {}),
    ...(schema !== undefined ? { schema } : {}),
  }
}

/**
 * Resolve the `db.map` (`@map` column override) for a better-auth field, or
 * `undefined` when there is no override (so default output is unchanged).
 *
 * The field builders capture `options.db` in a closure when generating Prisma
 * types, so the column map MUST be passed through the builder's `db` option
 * rather than patched onto the returned field object.
 */
function fieldDb(fieldName: string, fields: Record<string, string>): { map: string } | undefined {
  const column = fields[fieldName]
  return column ? { map: column } : undefined
}

/**
 * Build the `db` config for a `user` relationship (`Session.user` /
 * `Account.user`), honouring a `userId` column override from the better-auth
 * `fields` map and mirroring better-auth's own FK shape: the physical column
 * defaults to `userId` (better-auth's own column name, rather than the
 * generator's Keystone-parity default of the field name `user`), `onDelete:
 * Cascade`, and a required (non-nullable) foreign key, since better-auth's
 * adapter always writes a `userId` on every session/account row it creates.
 * This means a generated Auth schema diffs clean against a live better-auth
 * database on all three dimensions instead of showing a spurious column
 * rename, a referential-action change, and a `DROP NOT NULL` (issues #679,
 * #863, #935). The FK index itself is set on the relationship field
 * (`isIndexed: true` in `createSessionList`/`createAccountList`), matching
 * better-auth's own `userId` index — see ADR-0007.
 */
function userRelationshipDb(fields: Record<string, string>): NonNullable<RelationshipField['db']> {
  return {
    isNullable: false,
    foreignKey: { map: fields.userId ?? 'userId' },
    extendPrismaSchema: ({ fkLine, relationLine }) => ({
      fkLine,
      relationLine: relationLine.replace('@relation(', '@relation(onDelete: Cascade, '),
    }),
  }
}

/**
 * Create the Auth user list, applying derived field column maps + table map and
 * wiring the session/account relationships to the derived keys. Ships closed
 * per ADR-0013 unless `userConfig.access` or `access.user` is supplied.
 */
function createUserList(
  model: NormalizedAuthModelConfig,
  keys: DerivedAuthLists['keys'],
  userConfig: ExtendUserListConfig,
  access: AuthAccessConfig['user'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
): ListConfig<any> {
  const f = model.fields
  return list({
    fields: {
      name: text({ validation: { isRequired: true }, db: fieldDb('name', f) }),
      email: text({
        validation: { isRequired: true },
        isIndexed: 'unique',
        db: fieldDb('email', f),
      }),
      emailVerified: checkbox({ defaultValue: false, db: fieldDb('emailVerified', f) }),
      image: text({ db: fieldDb('image', f) }),

      sessions: relationship({ ref: `${keys.session}.user`, many: true }),
      accounts: relationship({ ref: `${keys.account}.user`, many: true }),

      ...(userConfig.fields || {}),
    },
    db: listDb(model, true),
    access: userConfig.access || access,
    hooks: userConfig.hooks,
  })
}

/** Create the Auth session list. Ships closed per ADR-0013 unless `access.session` is supplied. */
function createSessionList(
  model: NormalizedAuthModelConfig,
  keys: DerivedAuthLists['keys'],
  access: AuthAccessConfig['session'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
): ListConfig<any> {
  const f = model.fields
  return list({
    fields: {
      token: text({
        validation: { isRequired: true },
        isIndexed: 'unique',
        db: fieldDb('token', f),
      }),
      expiresAt: timestamp({
        db: { isNullable: false, ...fieldDb('expiresAt', f) },
      }),
      ipAddress: text({ db: fieldDb('ipAddress', f) }),
      userAgent: text({ db: fieldDb('userAgent', f) }),
      user: relationship({
        ref: `${keys.user}.sessions`,
        isIndexed: true,
        db: userRelationshipDb(f),
      }),
    },
    db: listDb(model, true),
    access,
  })
}

/** Create the Auth account list. Ships closed per ADR-0013 unless `access.account` is supplied. */
function createAccountList(
  model: NormalizedAuthModelConfig,
  keys: DerivedAuthLists['keys'],
  access: AuthAccessConfig['account'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
): ListConfig<any> {
  const f = model.fields
  return list({
    fields: {
      accountId: text({ validation: { isRequired: true }, db: fieldDb('accountId', f) }),
      providerId: text({ validation: { isRequired: true }, db: fieldDb('providerId', f) }),
      user: relationship({
        ref: `${keys.user}.accounts`,
        isIndexed: true,
        db: userRelationshipDb(f),
      }),
      accessToken: text({ db: fieldDb('accessToken', f) }),
      refreshToken: text({ db: fieldDb('refreshToken', f) }),
      accessTokenExpiresAt: timestamp({ db: fieldDb('accessTokenExpiresAt', f) }),
      refreshTokenExpiresAt: timestamp({ db: fieldDb('refreshTokenExpiresAt', f) }),
      scope: text({ db: fieldDb('scope', f) }),
      idToken: text({ db: fieldDb('idToken', f) }),
      password: text({ db: fieldDb('password', f) }),
    },
    db: listDb(model, true),
    access,
  })
}

/** Create the Auth verification list. Ships closed per ADR-0013 unless `access.verification` is supplied. */
function createVerificationList(
  model: NormalizedAuthModelConfig,
  access: AuthAccessConfig['verification'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
): ListConfig<any> {
  const f = model.fields
  return list({
    fields: {
      identifier: text({
        validation: { isRequired: true },
        isIndexed: true,
        db: fieldDb('identifier', f),
      }),
      value: text({ validation: { isRequired: true }, db: fieldDb('value', f) }),
      expiresAt: timestamp({
        db: { isNullable: false, ...fieldDb('expiresAt', f) },
      }),
    },
    db: listDb(model, true),
    access,
  })
}

/**
 * Create the Auth rate-limit list, present only when `rateLimit.storage ===
 * 'database'` derives a `rateLimit` model. Mirrors better-auth's own
 * `rateLimit` table exactly (`getAuthTables` in `@better-auth/core`, verified
 * against better-auth@1.6.25): `key` (unique — load-bearing, not cosmetic,
 * since the limiter races concurrent requests into a create and relies on the
 * resulting constraint violation to serialise them), `count`, and
 * `lastRequest` (a millisecond epoch, hence `bigInt()` rather than
 * `integer()`, which would overflow). None of the three columns carries a
 * Prisma default — the limiter supplies `lastRequest` explicitly on every
 * create/update, and an adopted live table has no default to match. No
 * `createdAt`/`updatedAt` either (see `listDb`'s `timestamps` argument):
 * better-auth's own rate-limit table has neither column.
 *
 * Ships closed per ADR-0013 unless `access.rateLimit` is supplied.
 */
function createRateLimitList(
  model: NormalizedAuthModelConfig,
  access: AuthAccessConfig['rateLimit'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
): ListConfig<any> {
  const f = model.fields
  return list({
    fields: {
      key: text({
        validation: { isRequired: true },
        isIndexed: 'unique',
        db: fieldDb('key', f),
      }),
      count: integer({
        validation: { isRequired: true },
        db: { isNullable: false, ...fieldDb('count', f) },
      }),
      lastRequest: bigInt({
        validation: { isRequired: true },
        db: { isNullable: false, ...fieldDb('lastRequest', f) },
      }),
    },
    db: listDb(model, false),
    access,
  })
}

/**
 * Derive the OpenSaaS Auth lists from the resolved better-auth model config.
 *
 * Per ADR-0013 the derived lists ship **closed** (no permissive operation
 * access) unless the application supplies access via `accessConfig` (the
 * `authPlugin({ access: … })` passthrough, keyed by better-auth model name) or,
 * for the user list specifically, `userConfig.access` (`extendUserList.access`,
 * which takes precedence — see {@link AuthAccessConfig}).
 *
 * A fifth `RateLimit` list is included only when `models.rateLimit` is
 * present (i.e. `rateLimit.storage === 'database'`).
 *
 * @param models - Resolved better-auth per-model config (modelName + field column maps)
 * @param userConfig - Extra User-list fields/access/hooks supplied via `extendUserList`
 * @param accessConfig - App-authored access for each Auth list, keyed by better-auth model name
 * @returns The derived list keys and the Auth list configs keyed by those keys
 */
export function deriveAuthLists(
  models: NormalizedAuthModels,
  userConfig: ExtendUserListConfig = {},
  accessConfig: AuthAccessConfig = {},
): DerivedAuthLists {
  const keys: DerivedAuthLists['keys'] = {
    user: models.user.modelName,
    session: models.session.modelName,
    account: models.account.modelName,
    verification: models.verification.modelName,
    ...(models.rateLimit ? { rateLimit: models.rateLimit.modelName } : {}),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  const lists: Record<string, ListConfig<any>> = {
    [keys.user]: createUserList(models.user, keys, userConfig, accessConfig.user),
    [keys.session]: createSessionList(models.session, keys, accessConfig.session),
    [keys.account]: createAccountList(models.account, keys, accessConfig.account),
    [keys.verification]: createVerificationList(models.verification, accessConfig.verification),
  }

  if (models.rateLimit && keys.rateLimit) {
    lists[keys.rateLimit] = createRateLimitList(models.rateLimit, accessConfig.rateLimit)
  }

  return { keys, lists }
}
