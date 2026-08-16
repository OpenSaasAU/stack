/**
 * Pure `better-auth config → Auth lists` derivation.
 *
 * This module is intentionally free of side effects and plugin/runtime
 * concerns: given the resolved better-auth model config (per-model `modelName`,
 * `tableName`, and `fields` column maps) plus any custom User fields, it
 * produces the four OpenSaaS Auth lists (user/session/account/verification)
 * with:
 *
 *  - list keys taken from each model's `modelName`
 *  - a table `@@map` (list-level `db.map`) taken from each model's resolved
 *    `tableName` — independent of `modelName`, so a renamed list key can still
 *    adopt a differently-named live table
 *  - field-level `@map` (`db.map`) for any better-auth field → column override
 *  - relationship refs between the auth lists wired to the *derived* keys
 *    (e.g. `Session.user → AuthUser.sessions`)
 *
 * When the developer supplies no `modelName`/`fields` overrides, the output
 * keeps the historical default keys (`User`/`Session`/`Account`/
 * `Verification`) and field shapes — see the unit tests. Per ADR-0013, each
 * list ships with **no** operation-level access unless the caller supplies it
 * (`accessConfig`, or `userConfig.access` for the user list) — deny-by-default,
 * not the plugin's former permissive defaults.
 *
 * `getAuthLists`/`convertBetterAuthSchema` (and the runtime user-key
 * resolution) consume this module so derivation lives in exactly one place.
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
 * `timestamps` is a per-model input rather than hardcoded: better-auth's
 * adapter writes `createdAt`/`updatedAt` on every user/session/account/
 * verification row (and the schema converter returns `null` for those columns,
 * assuming the generator injects them), so those four opt back into
 * auto-timestamps now that they're OFF by default (ADR-0004). The `RateLimit`
 * model has neither column in better-auth's own schema, so it passes `false`.
 *
 * The physical table name (`@@map`) comes from the model's resolved
 * `tableName` — independent of the list key/`modelName` — so a renamed list
 * key can still adopt a differently-named live table (e.g. better-auth's own
 * default lowercase table names). When a `schema` is configured (plugin-level
 * or per-model), the list is placed in that Postgres schema via `@@schema(...)`.
 *
 * With no `tableName`/`schema` overrides and `timestamps: true` we emit only
 * `{ timestamps: true }`, leaving the default `User`/`Session`/... output
 * unchanged.
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
 * `fields` map and mirroring better-auth's own FK shape: no separate FK index
 * — the index is applied at the field level via `isIndexed: false` —
 * `onDelete: Cascade`, and a required (non-nullable) foreign key, since
 * better-auth's adapter always writes a `userId` on every session/account row
 * it creates. This means a generated Auth schema diffs clean against a live
 * better-auth database on all three dimensions instead of showing a spurious
 * index drop, a referential-action change, and a `DROP NOT NULL` (issues #679,
 * #863).
 */
function userRelationshipDb(fields: Record<string, string>): NonNullable<RelationshipField['db']> {
  const column = fields.userId
  return {
    isNullable: false,
    ...(column ? { foreignKey: { map: column } } : {}),
    extendPrismaSchema: ({ fkLine, relationLine }) => ({
      fkLine,
      relationLine: relationLine.replace('@relation(', '@relation(onDelete: Cascade, '),
    }),
  }
}

/**
 * Create the Auth user list, applying derived field column maps + table map and
 * wiring the session/account relationships to the derived keys.
 *
 * Per ADR-0013, the plugin ships no permissive access default: the list is
 * closed unless the application supplies access via `extendUserList.access`
 * (takes precedence — it predates the keyed `access` passthrough and is
 * User-specific) or the `access.user` passthrough.
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

      // Relationships to the other auth lists — refs follow the derived keys.
      sessions: relationship({ ref: `${keys.session}.user`, many: true }),
      accounts: relationship({ ref: `${keys.account}.user`, many: true }),

      // Custom fields from user config
      ...(userConfig.fields || {}),
    },
    db: listDb(model, true),
    access: userConfig.access || access,
    hooks: userConfig.hooks,
  })
}

/**
 * Create the Auth session list.
 *
 * Per ADR-0013, the plugin ships no permissive access default — closed unless
 * the application supplies `access.session`.
 */
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
        isIndexed: false,
        db: userRelationshipDb(f),
      }),
    },
    db: listDb(model, true),
    access,
  })
}

/**
 * Create the Auth account list.
 *
 * Per ADR-0013, the plugin ships no permissive access default — closed unless
 * the application supplies `access.account`.
 */
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
        isIndexed: false,
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

/**
 * Create the Auth verification list.
 *
 * Per ADR-0013, the plugin ships no permissive access default — closed unless
 * the application supplies `access.verification`.
 */
function createVerificationList(
  model: NormalizedAuthModelConfig,
  access: AuthAccessConfig['verification'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
): ListConfig<any> {
  const f = model.fields
  return list({
    fields: {
      identifier: text({ validation: { isRequired: true }, db: fieldDb('identifier', f) }),
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
 * Per ADR-0013, the plugin ships no permissive access default — closed unless
 * the application supplies `access.rateLimit`.
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
