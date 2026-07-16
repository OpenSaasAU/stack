/**
 * Pure `better-auth config → Auth lists` derivation.
 *
 * This module is intentionally free of side effects and plugin/runtime
 * concerns: given the resolved better-auth model config (per-model `modelName`
 * and `fields` column maps) plus any custom User fields, it produces the four
 * OpenSaaS Auth lists (user/session/account/verification) with:
 *
 *  - list keys taken from each model's `modelName`
 *  - a table `@@map` (list-level `db.map`) when the key differs from the
 *    default better-auth model name
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
import { text, timestamp, checkbox, relationship } from '@opensaas/stack-core/fields'
import type { ListConfig } from '@opensaas/stack-core'
import type { RelationshipField } from '@opensaas/stack-core/fields'
import type { ExtendUserListConfig } from '../lists/index.js'
import type { AuthAccessConfig, NormalizedAuthModelConfig, NormalizedAuthModels } from './types.js'

/**
 * Default better-auth model names — used to decide whether a `@@map` is needed
 * (only when the configured `modelName` differs from the default).
 */
const DEFAULT_MODEL_NAMES = {
  user: 'User',
  session: 'Session',
  account: 'Account',
  verification: 'Verification',
} as const

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
  }
  /** The derived list configs, keyed by their derived list keys. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  lists: Record<string, ListConfig<any>>
}

/**
 * Build the list-level `db` config (`timestamps` + `@@map` + `@@schema`) for a
 * derived list.
 *
 * Always opts the list into auto-timestamps (`timestamps: true`). better-auth's
 * adapter writes `createdAt`/`updatedAt` on every auth row and the schema
 * converter returns `null` for those columns (it assumes the generator injects
 * them). Now that auto-timestamps are OFF by default (ADR-0004), each derived
 * Auth list must opt back in so the generated models keep those columns and
 * better-auth keeps working.
 *
 * When the developer renames the model (e.g. `modelName: 'AuthUser'`), we also
 * pin the physical table name to that model name via `@@map("AuthUser")` so the
 * generated list adopts the developer's live table exactly. When a `schema` is
 * configured (plugin-level or per-model), the list is placed in that Postgres
 * schema via `@@schema(...)`.
 *
 * With no `modelName`/`schema` overrides we emit only `timestamps: true`,
 * leaving the default `User`/`Session`/... table/schema output unchanged.
 */
function listDb(
  model: NormalizedAuthModelConfig,
  defaultModelName: string,
): { timestamps: true; map?: string; schema?: string } {
  const map = model.modelName !== defaultModelName ? model.modelName : undefined
  const schema = model.schema
  return {
    timestamps: true,
    ...(map !== undefined ? { map } : {}),
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
 * — the index is applied at the field level via `isIndexed: false` — and
 * `onDelete: Cascade`, so a generated Auth schema diffs clean against a live
 * better-auth database on both dimensions instead of showing a spurious index
 * drop and a referential-action change (issue #679).
 */
function userRelationshipDb(fields: Record<string, string>): NonNullable<RelationshipField['db']> {
  const column = fields.userId
  return {
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
    db: listDb(model, DEFAULT_MODEL_NAMES.user),
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
      expiresAt: timestamp({ db: fieldDb('expiresAt', f) }),
      ipAddress: text({ db: fieldDb('ipAddress', f) }),
      userAgent: text({ db: fieldDb('userAgent', f) }),
      user: relationship({
        ref: `${keys.user}.sessions`,
        isIndexed: false,
        db: userRelationshipDb(f),
      }),
    },
    db: listDb(model, DEFAULT_MODEL_NAMES.session),
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
    db: listDb(model, DEFAULT_MODEL_NAMES.account),
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
      expiresAt: timestamp({ db: fieldDb('expiresAt', f) }),
    },
    db: listDb(model, DEFAULT_MODEL_NAMES.verification),
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
 * @param models - Resolved better-auth per-model config (modelName + field column maps)
 * @param userConfig - Extra User-list fields/access/hooks supplied via `extendUserList`
 * @param accessConfig - App-authored access for each Auth list, keyed by better-auth model name
 * @returns The derived list keys and the four Auth list configs keyed by those keys
 */
export function deriveAuthLists(
  models: NormalizedAuthModels,
  userConfig: ExtendUserListConfig = {},
  accessConfig: AuthAccessConfig = {},
): DerivedAuthLists {
  const keys = {
    user: models.user.modelName,
    session: models.session.modelName,
    account: models.account.modelName,
    verification: models.verification.modelName,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  const lists: Record<string, ListConfig<any>> = {
    [keys.user]: createUserList(models.user, keys, userConfig, accessConfig.user),
    [keys.session]: createSessionList(models.session, keys, accessConfig.session),
    [keys.account]: createAccountList(models.account, keys, accessConfig.account),
    [keys.verification]: createVerificationList(models.verification, accessConfig.verification),
  }

  return { keys, lists }
}
