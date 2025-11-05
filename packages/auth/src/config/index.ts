import type {
  AuthConfig,
  NormalizedAuthConfig,
  EmailPasswordConfig,
  EmailVerificationConfig,
  PasswordResetConfig,
} from './types.js'

/**
 * Normalize auth configuration with defaults
 */
export function normalizeAuthConfig(config: AuthConfig): NormalizedAuthConfig {
  // Email and password defaults
  const emailAndPassword = config.emailAndPassword?.enabled
    ? {
        enabled: true as const,
        minPasswordLength: (config.emailAndPassword as EmailPasswordConfig).minPasswordLength ?? 8,
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
    sendEmail:
      config.sendEmail ||
      (async ({ to, subject, html }) => {
        console.log('[Auth] Email not sent (no sendEmail configured):')
        console.log(`To: ${to}`)
        console.log(`Subject: ${subject}`)
        console.log(`Body: ${html}`)
      }),
    betterAuthPlugins: config.betterAuthPlugins || [],
  }
}

export type { AuthConfig, NormalizedAuthConfig }
export * from './types.js'
