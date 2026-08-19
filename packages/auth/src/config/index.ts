import type {
  AuthConfig,
  AuthModelConfig,
  NormalizedAuthConfig,
  NormalizedAuthModelConfig,
  NormalizedAuthModels,
  EmailPasswordConfig,
  EmailVerificationConfig,
  PasswordResetConfig,
  SendAuthEmail,
} from './types.js'

const DEFAULT_MODEL_NAMES = {
  user: 'User',
  session: 'Session',
  account: 'Account',
  verification: 'Verification',
  rateLimit: 'RateLimit',
} as const

/**
 * `tableName` defaults to today's behaviour when not explicitly set: it
 * follows `modelName` when that differs from the better-auth default (so a
 * renamed list still pins its table via `@@map`), otherwise it stays unset.
 * An explicit `tableName` is independent of `modelName` — it lets a renamed
 * list key adopt a differently-named live table (e.g. better-auth's own
 * default lowercase table names).
 */
function normalizeModelConfig(
  config: AuthModelConfig | undefined,
  defaultModelName: string,
  defaultSchema: string | undefined,
): NormalizedAuthModelConfig {
  const modelName = config?.modelName || defaultModelName
  const tableName = config?.tableName ?? (modelName !== defaultModelName ? modelName : undefined)
  return {
    modelName,
    tableName,
    fields: config?.fields || {},
    schema: config?.schema ?? defaultSchema,
  }
}

function normalizeAuthModels(config: AuthConfig): NormalizedAuthModels {
  const defaultSchema = config.schema
  const models: NormalizedAuthModels = {
    user: normalizeModelConfig(config.user, DEFAULT_MODEL_NAMES.user, defaultSchema),
    session: normalizeModelConfig(config.session, DEFAULT_MODEL_NAMES.session, defaultSchema),
    account: normalizeModelConfig(config.account, DEFAULT_MODEL_NAMES.account, defaultSchema),
    verification: normalizeModelConfig(
      config.verification,
      DEFAULT_MODEL_NAMES.verification,
      defaultSchema,
    ),
  }

  if (config.rateLimit?.storage === 'database') {
    models.rateLimit = normalizeModelConfig(
      config.rateLimit,
      DEFAULT_MODEL_NAMES.rateLimit,
      defaultSchema,
    )
  }

  return models
}

function defaultSendAuthEmail(kind: 'password reset' | 'verification'): SendAuthEmail {
  return async ({ user, url }) => {
    console.log(
      `[Auth] ${kind[0].toUpperCase()}${kind.slice(1)} email not sent (no callback configured):`,
    )
    console.log(`To: ${user.email}`)
    console.log(`URL: ${url}`)
  }
}

export function normalizeAuthConfig(config: AuthConfig): NormalizedAuthConfig {
  const emailAndPassword = config.emailAndPassword?.enabled
    ? {
        enabled: true as const,
        minPasswordLength: (config.emailAndPassword as EmailPasswordConfig).minPasswordLength ?? 8,
        requireConfirmation:
          (config.emailAndPassword as EmailPasswordConfig).requireConfirmation ?? true,
        sendResetPassword:
          (config.emailAndPassword as EmailPasswordConfig).sendResetPassword ??
          defaultSendAuthEmail('password reset'),
      }
    : {
        enabled: false as const,
        minPasswordLength: 8,
        requireConfirmation: true,
        sendResetPassword: defaultSendAuthEmail('password reset'),
      }

  const emailVerification = config.emailVerification?.enabled
    ? {
        enabled: true as const,
        sendOnSignUp: (config.emailVerification as EmailVerificationConfig).sendOnSignUp ?? true,
        tokenExpiration:
          (config.emailVerification as EmailVerificationConfig).tokenExpiration ?? 86400,
        sendVerificationEmail:
          (config.emailVerification as EmailVerificationConfig).sendVerificationEmail ??
          defaultSendAuthEmail('verification'),
      }
    : {
        enabled: false as const,
        sendOnSignUp: true,
        tokenExpiration: 86400,
        sendVerificationEmail: defaultSendAuthEmail('verification'),
      }

  const passwordReset = config.passwordReset?.enabled
    ? {
        enabled: true as const,
        tokenExpiration: (config.passwordReset as PasswordResetConfig).tokenExpiration ?? 3600,
      }
    : { enabled: false as const, tokenExpiration: 3600 }

  const session = {
    expiresIn: config.session?.expiresIn || 604800,
    updateAge: config.session?.updateAge ?? 86400, // matches better-auth's own default
  }

  const sessionFields = config.sessionFields || ['userId', 'email', 'name']

  const models = normalizeAuthModels(config)

  return {
    emailAndPassword,
    emailVerification,
    passwordReset,
    socialProviders: config.socialProviders || {},
    session,
    models,
    schema: config.schema,
    sessionFields,
    extendUserList: config.extendUserList || {},
    access: config.access || {},
    betterAuthPlugins: config.betterAuthPlugins || [],
    rateLimit: config.rateLimit,
    betterAuthOptions: config.betterAuthOptions || {},
  }
}

export type { AuthConfig, NormalizedAuthConfig }
export * from './types.js'
