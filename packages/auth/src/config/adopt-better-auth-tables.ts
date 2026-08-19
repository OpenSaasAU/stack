/**
 * "Adopt existing better-auth tables" recipe: produces the {@link AuthConfig}
 * adoption fragment for a pre-existing better-auth install. See
 * `packages/auth/CLAUDE.md` ("Adopting an existing better-auth install") for
 * the full rationale and examples.
 */

import type { AuthConfig, AuthModelConfig } from './types.js'

/**
 * Options for {@link adoptBetterAuthTables}.
 *
 * All options are optional and default to the conventions of a standard
 * separate-schema better-auth install (an `auth` Postgres schema with
 * `Auth`-prefixed model names).
 */
export type AdoptBetterAuthTablesOptions = {
  /**
   * The Postgres schema the live better-auth tables live in.
   *
   * Applied as the plugin-level {@link AuthConfig.schema}, placing every Auth
   * list in this schema via `@@schema(...)`. Pass `'public'` (or any single
   * schema) for an install that is not on a separate schema; pass an explicit
   * value to match your layout.
   *
   * @default 'auth'
   */
  schema?: string

  /**
   * Prefix applied to each better-auth model name to derive the list key /
   * table name (e.g. prefix `'Auth'` → `AuthUser`/`AuthSession`/...).
   *
   * A live better-auth install with `modelName: 'AuthUser'` etc. is the common
   * case; override this if your tables use a different prefix. Set to `''` to
   * keep the default better-auth names (`User`/`Session`/...) — but note that an
   * unprefixed `User` will share the app's `User` key, so prefer a prefix when
   * your domain `User` is a separate model (see {@link AuthConfig.user}).
   *
   * @default 'Auth'
   */
  modelNamePrefix?: string

  /**
   * Per-model better-auth field → column maps, keyed by model.
   *
   * Only needed when your live tables renamed columns away from the better-auth
   * defaults (e.g. `name → full_name`). Merged into the matching model config so
   * the derived field-level `@map`s match your live columns.
   *
   * @example
   * ```typescript
   * adoptBetterAuthTables({
   *   fields: {
   *     user: { name: 'full_name' },
   *     session: { userId: 'user_id' },
   *   },
   * })
   * ```
   */
  fields?: {
    user?: Record<string, string>
    session?: Record<string, string>
    account?: Record<string, string>
    verification?: Record<string, string>
    rateLimit?: Record<string, string>
  }

  /**
   * Set every model's physical table name to better-auth's own default
   * lowercase table name (`user`, `session`, `account`, `verification`) —
   * independent of the prefixed list key/`modelName`.
   *
   * This is the single most common adoption shape: a project that ran
   * better-auth before adding the stack has exactly these tables, and the
   * default `modelNamePrefix: 'Auth'` alone would otherwise pin the table
   * name to the prefixed model name (`AuthUser`, ...), which `prisma migrate
   * diff` reads as a rename against the live `user` table.
   *
   * Ignored for a model with an explicit entry in {@link tableNames}.
   *
   * @default false
   */
  useBetterAuthTableNames?: boolean

  /**
   * Per-model explicit table name overrides, keyed by model. Takes
   * precedence over `useBetterAuthTableNames` for that model.
   *
   * @example
   * ```typescript
   * adoptBetterAuthTables({ tableNames: { user: 'users' } })
   * ```
   */
  tableNames?: {
    user?: string
    session?: string
    account?: string
    verification?: string
    rateLimit?: string
  }

  /**
   * Also adopt an existing database-backed rate limiter table, deriving a
   * fifth `<prefix>RateLimit` Auth list alongside the other four (per
   * ADR-0007). Better-auth only creates this table when
   * `rateLimit.storage: 'database'` — most installs use the in-memory
   * limiter, so this defaults to `false` and must be opted into explicitly.
   * The returned fragment sets `rateLimit: { enabled: true, storage:
   * 'database', modelName: ... }`; override `enabled`/`window`/`max` by
   * setting `rateLimit` again on your own `authPlugin` config after spreading
   * this fragment.
   *
   * @default false
   */
  rateLimit?: boolean
}

const MODEL_DEFAULT_NAMES = {
  user: 'User',
  session: 'Session',
  account: 'Account',
  verification: 'Verification',
  rateLimit: 'RateLimit',
} as const

const BETTER_AUTH_DEFAULT_TABLE_NAMES = {
  user: 'user',
  session: 'session',
  account: 'account',
  verification: 'verification',
  rateLimit: 'rateLimit',
} as const

/**
 * The adoption-relevant slice of {@link AuthConfig}: the plugin-level `schema`
 * and the per-model `modelName`/`fields` (`user`/`session`/`account`/
 * `verification` always; `rateLimit` only when the `rateLimit` option is set).
 * Returned (not the full `AuthConfig`) so it spreads cleanly into the
 * developer's own `authPlugin` config.
 */
export type AdoptBetterAuthTablesConfig = Pick<
  AuthConfig,
  'schema' | 'user' | 'session' | 'account' | 'verification'
> & {
  rateLimit?: AuthConfig['rateLimit']
}

/**
 * Build the adoption {@link AuthConfig} fragment for a pre-existing better-auth
 * installation.
 *
 * Returns only the model/schema knobs needed to adopt the live tables; spread it
 * into {@link authPlugin} alongside your own auth config.
 */
export function adoptBetterAuthTables(
  options: AdoptBetterAuthTablesOptions = {},
): AdoptBetterAuthTablesConfig {
  const {
    schema = 'auth',
    modelNamePrefix = 'Auth',
    fields = {},
    useBetterAuthTableNames = false,
    tableNames = {},
    rateLimit = false,
  } = options

  const buildModel = (model: keyof typeof MODEL_DEFAULT_NAMES): AuthModelConfig => {
    const config: AuthModelConfig = {
      modelName: `${modelNamePrefix}${MODEL_DEFAULT_NAMES[model]}`,
    }
    const tableName =
      tableNames[model] ??
      (useBetterAuthTableNames ? BETTER_AUTH_DEFAULT_TABLE_NAMES[model] : undefined)
    if (tableName !== undefined) {
      config.tableName = tableName
    }
    const fieldMap = fields[model]
    if (fieldMap && Object.keys(fieldMap).length > 0) {
      config.fields = fieldMap
    }
    return config
  }

  return {
    schema,
    user: buildModel('user'),
    session: buildModel('session'),
    account: buildModel('account'),
    verification: buildModel('verification'),
    ...(rateLimit
      ? { rateLimit: { enabled: true, storage: 'database' as const, ...buildModel('rateLimit') } }
      : {}),
  }
}
