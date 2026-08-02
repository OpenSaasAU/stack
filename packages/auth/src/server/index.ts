import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import type { BetterAuthOptions } from 'better-auth'
import type { OpenSaasConfig, AccessContext } from '@opensaas/stack-core'
import type { DatabaseConfig } from '@opensaas/stack-core/internal'
import type { NormalizedAuthConfig, NormalizedAuthModelConfig } from '../config/types.js'

/**
 * Get better-auth database configuration from OpenSaas config
 */
function getDatabaseConfig(
  dbConfig: DatabaseConfig,
  context: AccessContext,
): BetterAuthOptions['database'] {
  return prismaAdapter(context.prisma, {
    provider: dbConfig.provider,
  })
}

/**
 * Translate a normalized OpenSaaS auth model config into the better-auth
 * per-model options (`modelName` + `fields` column map). Returns `undefined`
 * when there is nothing to override so the running auth instance keeps
 * better-auth's own defaults untouched.
 */
function toBetterAuthModelOptions(
  model: NormalizedAuthModelConfig,
): { modelName?: string; fields?: Record<string, string> } | undefined {
  const hasFields = Object.keys(model.fields).length > 0
  const options: { modelName?: string; fields?: Record<string, string> } = {}
  if (model.modelName) options.modelName = model.modelName
  if (hasFields) options.fields = model.fields
  return Object.keys(options).length > 0 ? options : undefined
}

const MODELS_WITH_NO_ADDITIONAL_FIELDS_PASSTHROUGH = [
  'user',
  'session',
  'account',
  'verification',
] as const

/**
 * Reject `betterAuthOptions` keys that already have a dedicated, non-passthrough
 * seam — accepting them here would create two unranked ways to set the same
 * thing, or (for `additionalFields`) silently diverge from the generated
 * Prisma schema. See the `betterAuthOptions` doc comment on `AuthConfig`.
 */
function assertNoUnsupportedPassthroughKeys(betterAuthOptions: Record<string, unknown>): void {
  if ('database' in betterAuthOptions) {
    throw new Error(
      '[@opensaas/stack-auth] `betterAuthOptions.database` is not supported — the stack ' +
        'derives the database adapter from your `db` config and the running context. ' +
        'Configure the database through `db` in `opensaas.config.ts` instead.',
    )
  }

  if ('plugins' in betterAuthOptions) {
    throw new Error(
      '[@opensaas/stack-auth] `betterAuthOptions.plugins` is not supported — better-auth ' +
        'plugins are added through `authPlugin({ betterAuthPlugins: [...] })`, which the stack ' +
        'appends `nextCookies()` after. Use `betterAuthPlugins` instead.',
    )
  }

  for (const model of MODELS_WITH_NO_ADDITIONAL_FIELDS_PASSTHROUGH) {
    const modelOptions = betterAuthOptions[model]
    if (
      modelOptions &&
      typeof modelOptions === 'object' &&
      !Array.isArray(modelOptions) &&
      'additionalFields' in modelOptions
    ) {
      throw new Error(
        `[@opensaas/stack-auth] \`betterAuthOptions.${model}.additionalFields\` is not ` +
          'supported — it adds columns that would not be reflected in the generated Prisma ' +
          'schema. Add fields to the derived list instead: ' +
          (model === 'user'
            ? '`extendUserList`, or declare the list yourself in your own `lists` config.'
            : 'declare the derived list yourself in your own `lists` config (the auth plugin ' +
              'merges in field additions for the models it derives).'),
      )
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

/**
 * Deep-merge `overrides` onto `base`, recursing into plain-object values so a
 * nested addition (one database hook, one session sub-option) merges
 * alongside sibling keys the stack already set there rather than replacing
 * the whole branch. Arrays and any other value type replace outright.
 * `overrides` wins on every key collision.
 */
function mergeBetterAuthOptions(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    const baseValue = result[key]
    result[key] =
      isPlainObject(baseValue) && isPlainObject(value)
        ? mergeBetterAuthOptions(baseValue, value)
        : value
  }
  return result
}

/**
 * Build the `BetterAuthOptions` a better-auth instance for this OpenSaas
 * config should be constructed with — the same options `createAuth()` uses
 * internally, available standalone for an app that still needs to hand-wire
 * its own `betterAuth()` instance (e.g. a third-party contract that requires
 * a resolved instance at module-init time). Keeps the auth plugin
 * authoritative for everything it models; the app's additions on top become
 * an explicit, reviewable diff instead of a parallel, hand-duplicated config.
 *
 * @example
 * ```typescript
 * import { betterAuth } from 'better-auth'
 * import { buildBetterAuthOptions } from '@opensaas/stack-auth/server'
 *
 * export const auth = betterAuth({
 *   ...(await buildBetterAuthOptions(config, context)),
 *   databaseHooks: { user: { create: { after: syncDomainUser } } },
 * })
 * ```
 */
export async function buildBetterAuthOptions(
  opensaasConfig: OpenSaasConfig | Promise<OpenSaasConfig>,
  context: AccessContext | Promise<AccessContext>,
): Promise<BetterAuthOptions> {
  const resolvedConfig = await Promise.resolve(opensaasConfig)
  const resolvedContext = await Promise.resolve(context)

  // Extract auth config from plugin data
  const authConfig = resolvedConfig._pluginData?.auth as NormalizedAuthConfig | undefined

  if (!authConfig) {
    throw new Error(
      'Auth config not found. Make sure to use authPlugin() in your opensaas.config.ts',
    )
  }

  // `requireConfirmation` has no better-auth equivalent — it's a UI-only
  // concern the pre-built forms already take as their own
  // `requirePasswordConfirmation` prop. Warn rather than silently drop it,
  // since setting it here looks like it should do something.
  if (
    authConfig.emailAndPassword.enabled &&
    authConfig.emailAndPassword.requireConfirmation !== true
  ) {
    console.warn(
      '[@opensaas/stack-auth] `emailAndPassword.requireConfirmation` has no effect here — ' +
        'createAuth() has no better-auth option to forward it to. Pass ' +
        '`requirePasswordConfirmation` directly to <SignUpForm> / <ResetPasswordForm> instead.',
    )
  }

  // `passwordReset` is wired through better-auth's `emailAndPassword` config
  // (there's no password to reset without a password-based account), so it
  // silently has no effect if email/password auth itself isn't enabled.
  if (authConfig.passwordReset.enabled && !authConfig.emailAndPassword.enabled) {
    console.warn(
      '[@opensaas/stack-auth] `passwordReset.enabled` has no effect here — ' +
        '`emailAndPassword.enabled` is false, so there is no password-based account to reset.',
    )
  }

  assertNoUnsupportedPassthroughKeys(authConfig.betterAuthOptions as Record<string, unknown>)

  // Build better-auth configuration
  const betterAuthConfig: BetterAuthOptions = {
    database: getDatabaseConfig(resolvedConfig.db, resolvedContext),

    // Mirror the per-model config (modelName + field column maps) back to
    // better-auth so the running auth instance reads/writes the same
    // tables/columns the OpenSaaS Auth lists were derived from.
    user: toBetterAuthModelOptions(authConfig.models.user),
    session: {
      ...toBetterAuthModelOptions(authConfig.models.session),
      expiresIn: authConfig.session.expiresIn || 604800,
      // better-auth treats `updateAge: 0` as "refresh on every request", not
      // "never refresh" — disabling refresh entirely requires its separate
      // `disableSessionRefresh` flag regardless of `updateAge`.
      ...(authConfig.session.updateAge === false
        ? { disableSessionRefresh: true }
        : { updateAge: authConfig.session.updateAge }),
    },
    account: toBetterAuthModelOptions(authConfig.models.account),
    verification: toBetterAuthModelOptions(authConfig.models.verification),

    // Enable email and password if configured
    emailAndPassword: authConfig.emailAndPassword.enabled
      ? {
          enabled: true,
          requireEmailVerification: authConfig.emailVerification.enabled,
          minPasswordLength: authConfig.emailAndPassword.minPasswordLength,
          ...(authConfig.passwordReset.enabled
            ? {
                sendResetPassword: authConfig.emailAndPassword.sendResetPassword,
                resetPasswordTokenExpiresIn: authConfig.passwordReset.tokenExpiration,
              }
            : {}),
        }
      : undefined,

    // Email verification (independent of emailAndPassword — also covers
    // e.g. a social-provider account whose email isn't yet verified)
    emailVerification: authConfig.emailVerification.enabled
      ? {
          sendVerificationEmail: authConfig.emailVerification.sendVerificationEmail,
          sendOnSignUp: authConfig.emailVerification.sendOnSignUp,
          expiresIn: authConfig.emailVerification.tokenExpiration,
        }
      : undefined,

    // Trust host (required for production)
    trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',') || [],

    // Social providers
    socialProviders: Object.entries(authConfig.socialProviders)
      .filter(([_, config]) => config?.enabled !== false)
      .reduce(
        (acc, [provider, config]) => {
          if (config) {
            acc[provider] = {
              clientId: config.clientId,
              clientSecret: config.clientSecret,
            }
          }
          return acc
        },
        {} as Record<string, { clientId: string; clientSecret: string }>,
      ),

    // Rate limiting configuration
    rateLimit: authConfig.rateLimit
      ? {
          enabled: authConfig.rateLimit.enabled,
          window: authConfig.rateLimit.window,
          max: authConfig.rateLimit.max,
        }
      : undefined,

    // Pass through any additional Better Auth plugins, then append
    // nextCookies LAST so it can write the Set-Cookie headers produced by
    // any auth.api.* call made inside a Next.js server action into Next's
    // cookie store. This is what makes the server-action auth forms (which
    // call auth.api.signInEmail/signUpEmail/etc. server-side) actually
    // persist a session. It must be the final plugin in the array.
    plugins: [...(authConfig.betterAuthPlugins || []), nextCookies()],
  }

  return mergeBetterAuthOptions(
    betterAuthConfig as unknown as Record<string, unknown>,
    authConfig.betterAuthOptions as Record<string, unknown>,
  ) as BetterAuthOptions
}

/**
 * Create a better-auth instance from OpenSaas config
 * This should be called once at app startup
 *
 * @example
 * ```typescript
 * // lib/auth.ts
 * import { createAuth } from '@opensaas/stack-auth/server'
 * import config from '../opensaas.config'
 * import { rawOpensaasContext } from '@/.opensaas/context'
 *
 * export const auth = createAuth(config, rawOpensaasContext)
 * ```
 */
export function createAuth(
  opensaasConfig: OpenSaasConfig | Promise<OpenSaasConfig>,
  context: AccessContext | Promise<AccessContext>,
) {
  // Resolve config and context asynchronously
  const configPromise = Promise.resolve(opensaasConfig)
  const contextPromise = Promise.resolve(context)

  // Create auth instance lazily when needed
  let authInstance: ReturnType<typeof betterAuth> | null = null
  let authPromise: Promise<ReturnType<typeof betterAuth>> | null = null

  async function getAuthInstance() {
    if (authInstance) return authInstance

    if (!authPromise) {
      authPromise = (async () => {
        const betterAuthConfig = await buildBetterAuthOptions(configPromise, contextPromise)
        authInstance = betterAuth(betterAuthConfig)
        return authInstance
      })()
    }

    return authPromise
  }

  // Return a proxy that lazily initializes the auth instance
  return new Proxy({} as ReturnType<typeof betterAuth>, {
    get(_, prop) {
      if (prop === 'then') {
        // Support await on the proxy itself
        return undefined
      }

      // Create a lazy wrapper function
      const lazyWrapper = async (...args: unknown[]) => {
        const instance = await getAuthInstance()
        const value = instance[prop as keyof typeof instance]
        if (typeof value === 'function') {
          return (value as (...args: unknown[]) => unknown).apply(instance, args)
        }
        return value
      }

      // Return a proxy that supports both direct calls and nested property access
      return new Proxy(lazyWrapper, {
        get(target, subProp) {
          if (subProp === 'then') {
            // Support await on nested properties
            return undefined
          }
          // Handle nested property access (e.g., auth.api.getSession)
          return async (...args: unknown[]) => {
            const instance = await getAuthInstance()
            const parentValue = instance[prop as keyof typeof instance]
            if (parentValue && typeof parentValue === 'object') {
              const childValue = (parentValue as Record<string, unknown>)[subProp as string]
              if (typeof childValue === 'function') {
                return (childValue as (...args: unknown[]) => unknown).apply(parentValue, args)
              }
              return childValue
            }
            throw new Error(
              `Property ${String(prop)}.${String(subProp)} not found on auth instance`,
            )
          }
        },
      })
    },
  })
}

/**
 * Get session from better-auth and transform it to OpenSaas session format.
 *
 * Not called by any generated code today — apps currently hand-roll this same
 * transform against `auth.api.getSession({ headers: await headers() })` (see
 * `examples/starter-auth/lib/auth.ts`). Exported as a reusable helper for that
 * pattern; pass the caller's request headers (e.g. Next.js `await headers()`
 * in a Server Component/action) so a session cookie can actually be resolved.
 */
export async function getSessionFromAuth(
  auth: ReturnType<typeof betterAuth>,
  sessionFields: string[],
  headers: Headers,
) {
  try {
    const session = await auth.api.getSession({ headers })

    if (!session?.user) {
      return null
    }

    // Build session object with requested fields
    const result: Record<string, unknown> = {}

    for (const field of sessionFields) {
      if (field === 'userId') {
        result.userId = session.user.id
      } else if (field in session.user) {
        result[field] = session.user[field as keyof typeof session.user]
      }
    }

    return result
  } catch {
    return null
  }
}

export type { BetterAuthOptions }
