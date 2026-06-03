/**
 * "Adopt existing better-auth tables" recipe.
 *
 * A migrating project usually already has a working, hand-wired better-auth
 * installation: its tables are `AuthUser`/`AuthSession`/`AuthAccount`/
 * `AuthVerification`, mapped into a separate `auth` Postgres schema, and its
 * application `User` (`public.User`) is a *different* model. Reconstructing the
 * matching {@link AuthConfig} by hand — four `modelName`s plus a `schema` on each
 * model — is repetitive and easy to get wrong.
 *
 * {@link adoptBetterAuthTables} produces that {@link AuthConfig} fragment from a
 * couple of options so the migrator doesn't rebuild it from scratch. It only
 * sets the *adoption* knobs (per-model `modelName` + the plugin-level `schema`);
 * the developer composes it with the rest of their auth config (providers,
 * session fields, `extendUserList`, etc.):
 *
 * ```typescript
 * authPlugin({
 *   ...adoptBetterAuthTables(),
 *   emailAndPassword: { enabled: true },
 *   sessionFields: ['userId', 'email', 'name'],
 * })
 * ```
 *
 * Combined with the keys/field derivation (`deriveAuthLists`) and schema
 * placement, the generated Auth lists reach **Schema parity** with the live
 * tables — they are modelled for runtime/types without producing a destructive
 * auth migration. The recipe never touches the application's own domain `User`:
 * its model names are `Auth`-prefixed by default and the plugin only ever
 * adds/extends its *derived* keys.
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
  }
}

/** The four better-auth models and their default (unprefixed) model names. */
const MODEL_DEFAULT_NAMES = {
  user: 'User',
  session: 'Session',
  account: 'Account',
  verification: 'Verification',
} as const

/**
 * The adoption-relevant slice of {@link AuthConfig}: the plugin-level `schema`
 * and the per-model `modelName`/`fields`. Returned (not the full `AuthConfig`)
 * so it spreads cleanly into the developer's own `authPlugin` config.
 */
export type AdoptBetterAuthTablesConfig = Pick<
  AuthConfig,
  'schema' | 'user' | 'session' | 'account' | 'verification'
>

/**
 * Build the adoption {@link AuthConfig} fragment for a pre-existing better-auth
 * installation.
 *
 * Returns only the model/schema knobs needed to adopt the live tables; spread it
 * into {@link authPlugin} alongside your own auth config.
 *
 * @param options - Adoption conventions (schema, model-name prefix, column maps)
 * @returns An {@link AuthConfig} fragment with `schema` + per-model `modelName`
 *   (and any field column maps) set to match the live tables
 */
export function adoptBetterAuthTables(
  options: AdoptBetterAuthTablesOptions = {},
): AdoptBetterAuthTablesConfig {
  const { schema = 'auth', modelNamePrefix = 'Auth', fields = {} } = options

  const buildModel = (model: keyof typeof MODEL_DEFAULT_NAMES): AuthModelConfig => {
    const config: AuthModelConfig = {
      modelName: `${modelNamePrefix}${MODEL_DEFAULT_NAMES[model]}`,
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
  }
}
