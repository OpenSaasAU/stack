import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import type { BetterAuthOptions, User } from 'better-auth'
import type { OpenSaasConfig, AccessContext } from '@opensaas/stack-core'
import type { DatabaseConfig } from '@opensaas/stack-core/internal'
import type { NormalizedAuthConfig, NormalizedAuthModelConfig } from '../config/types.js'

/**
 * Build the better-auth `sendVerificationEmail`/`sendResetPassword` callback
 * from the normalized `sendEmail` config, rendering a minimal HTML body
 * around the link better-auth provides.
 */
function toSendEmailCallback(
  sendEmail: NormalizedAuthConfig['sendEmail'],
  subject: string,
  bodyText: string,
) {
  return async ({ user, url }: { user: User; url: string }) => {
    await sendEmail({
      to: user.email,
      subject,
      html: `<p>${bodyText}</p><p><a href="${url}">${url}</a></p>`,
    })
  }
}

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
        const resolvedConfig = await configPromise
        const resolvedContext = await contextPromise

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
        if (authConfig.emailAndPassword.requireConfirmation !== true) {
          console.warn(
            '[@opensaas/stack-auth] `emailAndPassword.requireConfirmation` has no effect here — ' +
              'createAuth() has no better-auth option to forward it to. Pass ' +
              '`requirePasswordConfirmation` directly to <SignUpForm> / <ResetPasswordForm> instead.',
          )
        }

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
            updateAge: authConfig.session.updateAge === false ? 0 : authConfig.session.updateAge,
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
                      sendResetPassword: toSendEmailCallback(
                        authConfig.sendEmail,
                        'Reset your password',
                        'Click the link below to reset your password:',
                      ),
                      resetPasswordTokenExpiresIn: authConfig.passwordReset.tokenExpiration,
                    }
                  : {}),
              }
            : undefined,

          // Email verification (independent of emailAndPassword — also covers
          // e.g. a social-provider account whose email isn't yet verified)
          emailVerification: authConfig.emailVerification.enabled
            ? {
                sendVerificationEmail: toSendEmailCallback(
                  authConfig.sendEmail,
                  'Verify your email address',
                  'Click the link below to verify your email address:',
                ),
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
