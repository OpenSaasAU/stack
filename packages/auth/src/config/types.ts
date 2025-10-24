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
   * Session configuration
   */
  session?: SessionConfig

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
}

/**
 * Internal normalized auth configuration
 * Used after parsing user config
 */
export type NormalizedAuthConfig = Required<
  Omit<AuthConfig, 'emailAndPassword' | 'emailVerification' | 'passwordReset'>
> & {
  emailAndPassword: Required<EmailPasswordConfig>
  emailVerification: Required<EmailVerificationConfig>
  passwordReset: Required<PasswordResetConfig>
}
