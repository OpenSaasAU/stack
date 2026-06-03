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
export type AuthModelConfig = {
  /**
   * The table/list name for this model.
   * Becomes the OpenSaaS list key (and Prisma model name) and the table `@@map`.
   * @default the default better-auth model name (e.g. 'User', 'Session')
   */
  modelName?: string
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
 * better-auth default) and a (possibly empty) `fields` column map.
 */
export type NormalizedAuthModelConfig = {
  modelName: string
  fields: Record<string, string>
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
  >
> & {
  emailAndPassword: Required<EmailPasswordConfig>
  emailVerification: Required<EmailVerificationConfig>
  passwordReset: Required<PasswordResetConfig>
  /** Resolved session expiry settings (model config lives under `models.session`). */
  session: Required<SessionConfig>
  /** Resolved better-auth model config (modelName + field column maps) for all auth models. */
  models: NormalizedAuthModels
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth plugin types are not exposed, must use any
  betterAuthPlugins: any[]
  rateLimit?: {
    enabled: boolean
    window?: number
    max?: number
  }
}
