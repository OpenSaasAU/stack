import type { ListConfig } from '@opensaas/stack-core'
import type { ExtendUserListConfig } from '../lists/index.js'

/**
 * OAuth provider configuration
 */
export type OAuthProvider = {
  clientId: string
  clientSecret: string
  enabled?: boolean
}

/**
 * Social provider configurations
 */
export type SocialProvidersConfig = {
  github?: OAuthProvider
  google?: OAuthProvider
  discord?: OAuthProvider
  twitter?: OAuthProvider
  [key: string]: OAuthProvider | undefined
}

/**
 * Email and password configuration
 */
export type EmailPasswordConfig = {
  enabled: boolean
  /**
   * Minimum password length
   * @default 8
   */
  minPasswordLength?: number
  /**
   * Require password confirmation
   * @default true
   */
  requireConfirmation?: boolean
}

/**
 * Email verification configuration
 */
export type EmailVerificationConfig = {
  enabled: boolean
  /**
   * Send verification email on sign up
   * @default true
   */
  sendOnSignUp?: boolean
  /**
   * Token expiration in seconds
   * @default 86400 (24 hours)
   */
  tokenExpiration?: number
}

/**
 * Password reset configuration
 */
export type PasswordResetConfig = {
  enabled: boolean
  /**
   * Token expiration in seconds
   * @default 3600 (1 hour)
   */
  tokenExpiration?: number
}

/**
 * Session configuration
 */
export type SessionConfig = {
  /**
   * Session expiration in seconds
   * @default 604800 (7 days)
   */
  expiresIn?: number
  /**
   * Update session expiration on each request
   * @default true
   */
  updateAge?: boolean
}

/**
 * Per-model better-auth configuration block.
 *
 * Mirrors better-auth's own `BetterAuthDBOptions` (the `user`/`session`/
 * `account`/`verification` config a developer already writes): `modelName`
 * renames the table/list and `fields` maps individual better-auth field names
 * to database column names. The auth plugin derives its Auth lists from this
 * config so the generated lists carry the same keys and column maps as the
 * developer's live better-auth tables.
 *
 * @example
 * ```typescript
 * authPlugin({
 *   user: { modelName: 'AuthUser', fields: { name: 'full_name' } },
 *   session: { modelName: 'AuthSession' },
 * })
 * ```
 */
/**
 * App-authored operation + field-level access control for the Auth lists,
 * keyed by better-auth model name (not by the derived list key, so it stays
 * remap-proof when e.g. `user.modelName: 'AuthUser'`).
 *
 * Per ADR-0013, the auth plugin ships its created lists (User/Session/
 * Account/Verification) **closed** — no permissive defaults. This is the
 * application's seam to grant them access: the plugin applies each entry to
 * the corresponding list when it creates it (its own `addList` path), so the
 * access rides along with the list's `@@map`/`@@schema`/fields and can't
 * drift from the plugin's shape. A model with no entry here stays closed
 * (deny-by-default).
 *
 * @example
 * ```typescript
 * authPlugin({
 *   access: {
 *     // Signed-in users can read the directory; only self can write.
 *     user: {
 *       operation: {
 *         query: ({ session }) => !!session,
 *         update: ({ session, item }) => session?.userId === item.id,
 *       },
 *     },
 *     // A user can read only their own sessions.
 *     session: {
 *       operation: {
 *         query: ({ session }) =>
 *           session ? { user: { id: { equals: session.userId } } } : false,
 *       },
 *     },
 *   },
 * })
 * ```
 */
export type AuthAccessConfig = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  user?: ListConfig<any>['access']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  session?: ListConfig<any>['access']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  account?: ListConfig<any>['access']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  verification?: ListConfig<any>['access']
}

export type AuthModelConfig = {
  /**
   * The table/list name for this model.
   * Becomes the OpenSaaS list key and Prisma model name.
   * @default the default better-auth model name (e.g. 'User', 'Session')
   */
  modelName?: string
  /**
   * The physical database table name for this model, independent of
   * `modelName`. Generates a `@@map("...")` on the derived list.
   *
   * Lets a renamed list key (e.g. `modelName: 'AuthUser'`, to avoid colliding
   * with an app's own domain `User`) still adopt a live table under a
   * different name — most commonly better-auth's own default lowercase
   * table names (`user`, `session`, `account`, `verification`).
   *
   * @default `modelName` when it differs from the better-auth default model
   *   name, otherwise unset (no `@@map`) — i.e. today's behaviour when this
   *   option is not set.
   *
   * @example
   * ```typescript
   * // List key AuthUser, but the live table is still called `user`.
   * user: { modelName: 'AuthUser', tableName: 'user' }
   * ```
   */
  tableName?: string
  /**
   * Map better-auth field names to database column names.
   * Each entry generates a `@map("column")` on the derived field.
   *
   * @example
   * ```typescript
   * fields: { name: 'full_name', emailVerified: 'email_verified' }
   * ```
   */
  fields?: Record<string, string>
  /**
   * Database schema (Postgres) for this auth model.
   * Generates a `@@schema("...")` on the derived list, overriding the
   * plugin-level {@link AuthConfig.schema} for this one model.
   *
   * @example
   * ```typescript
   * // Place the verification table in a different schema from the rest
   * verification: { schema: 'auth_internal' }
   * ```
   */
  schema?: string
}

/**
 * Auth configuration options
 */
export type AuthConfig = {
  /**
   * Email and password authentication
   */
  emailAndPassword?: EmailPasswordConfig | { enabled: true }

  /**
   * Email verification
   */
  emailVerification?: EmailVerificationConfig | { enabled: true }

  /**
   * Password reset
   */
  passwordReset?: PasswordResetConfig | { enabled: true }

  /**
   * OAuth/social providers
   */
  socialProviders?: SocialProvidersConfig

  /**
   * Session configuration.
   *
   * Carries session expiry settings as well as the better-auth `session` model
   * config (`modelName` + field column `fields` maps) used to derive the Auth
   * session list.
   */
  session?: SessionConfig & AuthModelConfig

  /**
   * better-auth `user` model configuration (modelName + field column maps).
   * Used to derive the Auth user list's key, table `@@map`, and field `@map`s.
   *
   * Custom fields beyond the better-auth basics are added via `extendUserList`.
   */
  user?: AuthModelConfig

  /**
   * better-auth `account` model configuration (modelName + field column maps).
   */
  account?: AuthModelConfig

  /**
   * better-auth `verification` model configuration (modelName + field column maps).
   */
  verification?: AuthModelConfig

  /**
   * Database schema (Postgres) for the generated Auth lists.
   *
   * When set, all four Auth lists (user/session/account/verification) are placed
   * in this schema via `@@schema(...)`, and the stack's multi-schema support is
   * wired automatically: the datasource `schemas` array gains this schema (plus
   * `public`) and the `multiSchema` preview feature is enabled. A per-model
   * {@link AuthModelConfig.schema} overrides this for an individual list.
   *
   * Useful for adopting an existing separate-schema better-auth installation
   * (e.g. an `auth` Postgres schema) so the generated lists diff clean against
   * the live tables. When unset, the Auth lists stay in the default `public`
   * schema and no `@@schema` is emitted (greenfield default unchanged).
   *
   * Only applies to the `postgresql` provider.
   *
   * @example Adopt an `auth`-schema better-auth install
   * ```typescript
   * authPlugin({
   *   schema: 'auth',
   *   user: { modelName: 'AuthUser' },
   *   session: { modelName: 'AuthSession' },
   *   account: { modelName: 'AuthAccount' },
   *   verification: { modelName: 'AuthVerification' },
   * })
   * ```
   */
  schema?: string

  /**
   * Which fields to include in the session object
   * This determines what data is available in access control functions
   * @default ['userId', 'email', 'name']
   *
   * @example
   * ```typescript
   * sessionFields: ['userId', 'email', 'name', 'role']
   * // session will be: { userId: string, email: string, name: string, role: string }
   * ```
   */
  sessionFields?: string[]

  /**
   * Extend the auto-generated User list with custom fields
   *
   * @example
   * ```typescript
   * extendUserList: {
   *   fields: {
   *     role: text({ defaultValue: 'user' }),
   *     company: text(),
   *   }
   * }
   * ```
   */
  extendUserList?: ExtendUserListConfig

  /**
   * App-authored access control for the Auth lists (User/Session/Account/
   * Verification), keyed by better-auth model name. See {@link AuthAccessConfig}.
   *
   * Per ADR-0013 the auth plugin ships these lists **closed** by default — a
   * model with no entry here denies every operation (`context.db` reads/writes
   * return `null`/`[]` and the list doesn't surface in the admin UI). Grant
   * access explicitly for any Auth list your application reads or writes
   * through `context.db`.
   *
   * For the `user` model specifically, {@link ExtendUserListConfig.access}
   * (via `extendUserList.access`) is still honoured and takes precedence over
   * `access.user` if both are set — it predates this option and remains the
   * narrower, User-specific override.
   */
  access?: AuthAccessConfig

  /**
   * Custom email sending function for verification and password reset
   * If not provided, emails will be logged to console
   *
   * @example
   * ```typescript
   * sendEmail: async ({ to, subject, html }) => {
   *   await resend.emails.send({ to, subject, html })
   * }
   * ```
   */
  sendEmail?: (params: { to: string; subject: string; html: string }) => Promise<void>

  /**
   * Additional Better Auth plugins to enable
   * Allows integrating any Better Auth plugin (MCP, 2FA, etc.)
   *
   * @example
   * ```typescript
   * import { mcp } from 'better-auth/plugins'
   *
   * betterAuthPlugins: [
   *   mcp({ loginPage: '/sign-in' })
   * ]
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth plugin types are not exposed, must use any
  betterAuthPlugins?: any[]

  /**
   * Rate limiting configuration
   * Controls rate limiting for authentication endpoints
   *
   * @example
   * ```typescript
   * // Disable rate limiting for testing
   * rateLimit: {
   *   enabled: process.env.DISABLE_RATE_LIMITING !== 'true',
   * }
   *
   * // Custom rate limits
   * rateLimit: {
   *   enabled: true,
   *   window: 60,  // 60 seconds
   *   max: 100,    // 100 requests per window
   * }
   * ```
   */
  rateLimit?: {
    enabled: boolean
    /**
     * Time window in seconds
     * @default 60
     */
    window?: number
    /**
     * Maximum requests per window
     * @default 100
     */
    max?: number
  }
}

/**
 * Resolved per-model auth configuration after normalization.
 * Always carries a concrete `modelName` (the developer's override or the
 * better-auth default) and a (possibly empty) `fields` column map. `tableName`
 * is the resolved physical table name — `undefined` means no `@@map` is
 * emitted (the list key doubles as the table name). `schema` carries the
 * resolved Postgres schema for the model (per-model override, else the
 * plugin-level schema, else `undefined` for the default `public` schema).
 */
export type NormalizedAuthModelConfig = {
  modelName: string
  tableName?: string
  fields: Record<string, string>
  schema?: string
}

/**
 * Resolved auth model configuration for all four better-auth models.
 * Consumed by the Auth-list derivation and the runtime user-key resolution.
 */
export type NormalizedAuthModels = {
  user: NormalizedAuthModelConfig
  session: NormalizedAuthModelConfig
  account: NormalizedAuthModelConfig
  verification: NormalizedAuthModelConfig
}

/**
 * Internal normalized auth configuration
 * Used after parsing user config
 */
export type NormalizedAuthConfig = Required<
  Omit<
    AuthConfig,
    | 'emailAndPassword'
    | 'emailVerification'
    | 'passwordReset'
    | 'betterAuthPlugins'
    | 'rateLimit'
    | 'session'
    | 'user'
    | 'account'
    | 'verification'
    | 'schema'
  >
> & {
  emailAndPassword: Required<EmailPasswordConfig>
  emailVerification: Required<EmailVerificationConfig>
  passwordReset: Required<PasswordResetConfig>
  /** Resolved session expiry settings (model config lives under `models.session`). */
  session: Required<SessionConfig>
  /** Resolved better-auth model config (modelName + field column maps + schema) for all auth models. */
  models: NormalizedAuthModels
  /**
   * Plugin-level Postgres schema for the Auth lists, if any. Resolved per-model
   * schemas live on `models.<model>.schema`; this is the unresolved plugin-level
   * default (used to wire the datasource `schemas` array during generation).
   */
  schema?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth plugin types are not exposed, must use any
  betterAuthPlugins: any[]
  rateLimit?: {
    enabled: boolean
    window?: number
    max?: number
  }
}
