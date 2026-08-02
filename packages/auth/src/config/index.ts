import type {
  AuthConfig,
  AuthModelConfig,
  NormalizedAuthConfig,
  NormalizedAuthModelConfig,
  NormalizedAuthModels,
  EmailPasswordConfig,
  EmailVerificationConfig,
  PasswordResetConfig,
} from './types.js'

/**
 * Default better-auth model names. Used when the developer does not override
 * `modelName`, preserving the historical `User`/`Session`/`Account`/`Verification`
 * keys exactly.
 */
const DEFAULT_MODEL_NAMES = {
  user: 'User',
  session: 'Session',
  account: 'Account',
  verification: 'Verification',
} as const

/**
 * Resolve a single better-auth model config block into its normalized form,
 * falling back to the better-auth default model name and an empty column map.
 * The model's Postgres schema is the per-model `schema` override when present,
 * otherwise the plugin-level `schema` default (or `undefined` for `public`).
 *
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

/**
 * Resolve the better-auth model config for all four auth models.
 * `defaultSchema` is the plugin-level `schema` applied to every model unless a
 * per-model `schema` override is given.
 */
function normalizeAuthModels(config: AuthConfig): NormalizedAuthModels {
  const defaultSchema = config.schema
  return {
    user: normalizeModelConfig(config.user, DEFAULT_MODEL_NAMES.user, defaultSchema),
    session: normalizeModelConfig(config.session, DEFAULT_MODEL_NAMES.session, defaultSchema),
    account: normalizeModelConfig(config.account, DEFAULT_MODEL_NAMES.account, defaultSchema),
    verification: normalizeModelConfig(
      config.verification,
      DEFAULT_MODEL_NAMES.verification,
      defaultSchema,
    ),
  }
}

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

  // Resolve better-auth per-model config (modelName + field column maps).
  // Defaults preserve the historical User/Session/Account/Verification keys.
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
    sendEmail:
      config.sendEmail ||
      (async ({ to, subject, html }) => {
        console.log('[Auth] Email not sent (no sendEmail configured):')
        console.log(`To: ${to}`)
        console.log(`Subject: ${subject}`)
        console.log(`Body: ${html}`)
      }),
    betterAuthPlugins: config.betterAuthPlugins || [],
    rateLimit: config.rateLimit,
  }
}

export type { AuthConfig, NormalizedAuthConfig }
export * from './types.js'
