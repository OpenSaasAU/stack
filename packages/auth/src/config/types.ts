import type { ListConfig } from '@opensaas/stack-core'
import type { BetterAuthOptions, BetterAuthPlugin, User } from 'better-auth'
import type { ExtendUserListConfig } from '../lists/index.js'

/**
 * better-auth's own callback shape for `sendVerificationEmail`/
 * `sendResetPassword` — `data` is exactly what better-auth passes (no stack
 * abstraction layered on top), and `request` is the raw request that
 * triggered it.
 */
export type SendAuthEmail = (
  data: { user: User; url: string; token: string },
  request?: Request,
) => Promise<void>

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
   * Require password confirmation (a second "confirm password" field).
   *
   * There is no better-auth server-side equivalent — this is purely a UI
   * concern. `createAuth()` does not read it. Pass it directly to the
   * pre-built forms instead: `<SignUpForm requirePasswordConfirmation={...} />`
   * / `<ResetPasswordForm requirePasswordConfirmation={...} />` (both default
   * to `true`). Setting it here has no effect and `createAuth()` warns if it
   * is configured.
   *
   * @default true
   */
  requireConfirmation?: boolean
  /**
   * Send a password reset email. Passed straight through to better-auth's own
   * `emailAndPassword.sendResetPassword` — the stack does not wrap or
   * reshape it. If not provided, reset emails are logged to console instead
   * of sent.
   *
   * @example
   * ```typescript
   * sendResetPassword: async ({ user, url }) => {
   *   await resend.emails.send({
   *     to: user.email,
   *     subject: 'Reset your password',
   *     html: `<a href="${url}">Reset your password</a>`,
   *   })
   * }
   * ```
   */
  sendResetPassword?: SendAuthEmail
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
  /**
   * Send a verification email. Passed straight through to better-auth's own
   * `emailVerification.sendVerificationEmail` — the stack does not wrap or
   * reshape it. If not provided, verification emails are logged to console
   * instead of sent.
   *
   * @example
   * ```typescript
   * sendVerificationEmail: async ({ user, url }) => {
   *   await resend.emails.send({
   *     to: user.email,
   *     subject: 'Verify your email',
   *     html: `<a href="${url}">Verify your email</a>`,
   *   })
   * }
   * ```
   */
  sendVerificationEmail?: SendAuthEmail
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
   * How often the session should be refreshed, in seconds. Passed straight
   * through to better-auth's own `session.updateAge`. Set `false` to disable
   * refresh entirely (the session expiry is then fixed at creation time).
   * @default 86400 (1 day, matching better-auth's own default)
   */
  updateAge?: number | false
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
   * Which fields to include in the session object passed to access control
   * functions — a **flattened projection** of the resolved better-auth
   * session, not the session's own shape. `getSessionFromAuth` (the
   * implementation the scaffolded `getSession()` calls) resolves each name
   * against a fixed precedence: a top-level key on the resolved session
   * object, then the `user` object, then the `session` sub-object.
   * `userId` is special-cased to the authenticated user's `id`.
   *
   * A `customSession` better-auth plugin fully replaces the resolved shape
   * (it can nest fields anywhere, e.g. under its own custom key) —
   * reconciling that shape against `sessionFields` is the application's job.
   * A listed name that can't be resolved is omitted and warns once per
   * field per process, naming what was checked, rather than silently
   * becoming `undefined` in an access control function.
   *
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
  betterAuthPlugins?: BetterAuthPlugin[]

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

  /**
   * Escape hatch for better-auth options the stack doesn't model — typed as
   * better-auth's own `BetterAuthOptions` so it stays in step with
   * better-auth's surface without the stack re-declaring it. Deep-merged into
   * the options `createAuth()` builds, applied LAST: a plain-object value at a
   * given key merges recursively with whatever the stack already set there
   * (so e.g. `session: { cookieCache: {...} }` adds alongside the stack's own
   * `session.expiresIn`/`updateAge` rather than clobbering them); any other
   * value (including arrays) replaces the stack's value outright. On a genuine
   * key collision, this option wins.
   *
   * `database` and `plugins` are rejected — they're already the dedicated
   * seams (the stack's `db` config, and `betterAuthPlugins` respectively) and
   * accepting them here would create two unranked ways to set the same thing.
   * So is `additionalFields` under `user`/`session`/`account`/`verification` —
   * it has schema consequences (new columns) that a passthrough can't also
   * apply to the generated Prisma schema; add fields to the derived list
   * instead (`extendUserList` for the user model, or declare the list
   * yourself for the others — see `packages/auth/CLAUDE.md`).
   *
   * The same options object is available standalone via
   * `buildBetterAuthOptions()` (`@opensaas/stack-auth/server`) for apps that
   * still need to hand-wire their own `betterAuth()` instance.
   *
   * @example
   * ```typescript
   * authPlugin({
   *   betterAuthOptions: {
   *     databaseHooks: { user: { create: { after: syncDomainUser } } },
   *     session: { cookieCache: { enabled: true, maxAge: 300 } },
   *     verification: { storeIdentifier: 'hashed' },
   *     baseURL: process.env.BETTER_AUTH_URL,
   *   },
   * })
   * ```
   */
  betterAuthOptions?: Partial<BetterAuthOptions>
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
  betterAuthPlugins: BetterAuthPlugin[]
  rateLimit?: {
    enabled: boolean
    window?: number
    max?: number
  }
}
