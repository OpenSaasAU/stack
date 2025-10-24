import type { OpenSaaSConfig } from '@opensaas/framework-core'
import type {
  AuthConfig,
  NormalizedAuthConfig,
  EmailPasswordConfig,
  EmailVerificationConfig,
  PasswordResetConfig,
} from './types.js'
import { getAuthLists } from '../lists/index.js'

/**
 * Normalize auth configuration with defaults
 */
export function normalizeAuthConfig(config: AuthConfig): NormalizedAuthConfig {
  // Email and password defaults
  const emailAndPassword = config.emailAndPassword?.enabled
    ? {
        enabled: true as const,
        minPasswordLength:
          (config.emailAndPassword as EmailPasswordConfig).minPasswordLength ?? 8,
        requireConfirmation:
          (config.emailAndPassword as EmailPasswordConfig).requireConfirmation ?? true,
      }
    : { enabled: false as const, minPasswordLength: 8, requireConfirmation: true }

  // Email verification defaults
  const emailVerification = config.emailVerification?.enabled
    ? {
        enabled: true as const,
        sendOnSignUp: (config.emailVerification as EmailVerificationConfig).sendOnSignUp ?? true,
        tokenExpiration:
          (config.emailVerification as EmailVerificationConfig).tokenExpiration ?? 86400,
      }
    : { enabled: false as const, sendOnSignUp: true, tokenExpiration: 86400 }

  // Password reset defaults
  const passwordReset = config.passwordReset?.enabled
    ? {
        enabled: true as const,
        tokenExpiration: (config.passwordReset as PasswordResetConfig).tokenExpiration ?? 3600,
      }
    : { enabled: false as const, tokenExpiration: 3600 }

  // Session defaults
  const session = {
    expiresIn: config.session?.expiresIn || 604800, // 7 days
    updateAge: config.session?.updateAge ?? true,
  }

  // Session fields defaults
  const sessionFields = config.sessionFields || ['userId', 'email', 'name']

  return {
    emailAndPassword,
    emailVerification,
    passwordReset,
    socialProviders: config.socialProviders || {},
    session,
    sessionFields,
    extendUserList: config.extendUserList || {},
    sendEmail: config.sendEmail || (async ({ to, subject, html }) => {
      console.log('[Auth] Email not sent (no sendEmail configured):')
      console.log(`To: ${to}`)
      console.log(`Subject: ${subject}`)
      console.log(`Body: ${html}`)
    }),
  }
}

/**
 * Auth configuration builder
 * Use this to create an auth configuration object
 *
 * @example
 * ```typescript
 * import { authConfig } from '@opensaas/framework-auth'
 *
 * const auth = authConfig({
 *   emailAndPassword: { enabled: true },
 *   emailVerification: { enabled: true },
 *   socialProviders: {
 *     github: { clientId: '...', clientSecret: '...' }
 *   }
 * })
 * ```
 */
export function authConfig(config: AuthConfig): AuthConfig {
  return config
}

/**
 * Wrap an OpenSaaS config with better-auth integration
 * This merges the auth lists into the user's config and sets up session handling
 *
 * @example
 * ```typescript
 * import { config } from '@opensaas/framework-core'
 * import { withAuth, authConfig } from '@opensaas/framework-auth'
 *
 * export default withAuth(
 *   config({
 *     db: { provider: 'sqlite', url: 'file:./dev.db' },
 *     lists: {
 *       Post: list({ ... })
 *     }
 *   }),
 *   authConfig({
 *     emailAndPassword: { enabled: true }
 *   })
 * )
 * ```
 */
export function withAuth(opensaasConfig: OpenSaaSConfig, authConfig: AuthConfig): OpenSaaSConfig {
  const normalized = normalizeAuthConfig(authConfig)

  // Get auth lists with user extensions
  const authLists = getAuthLists(normalized.extendUserList)

  // Merge auth lists with user lists (auth lists take priority)
  const mergedLists = {
    ...opensaasConfig.lists,
    ...authLists,
  }

  // Return merged config with auth config attached
  // Note: Session integration happens in the generator/context
  const result: OpenSaaSConfig & { __authConfig?: NormalizedAuthConfig } = {
    ...opensaasConfig,
    lists: mergedLists,
  }

  // Store auth config for internal use
  result.__authConfig = normalized

  return result
}

export type { AuthConfig, NormalizedAuthConfig }
export * from './types.js'
