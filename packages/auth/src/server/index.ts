import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import type { BetterAuthOptions } from 'better-auth'
import type { OpenSaasConfig, DatabaseConfig, AccessContext } from '@opensaas/stack-core'
import type { NormalizedAuthConfig } from '../config/types.js'

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

        // Build better-auth configuration
        const betterAuthConfig: BetterAuthOptions = {
          database: getDatabaseConfig(resolvedConfig.db, resolvedContext),

          // Enable email and password if configured
          emailAndPassword: authConfig.emailAndPassword.enabled
            ? {
                enabled: true,
                requireEmailVerification: authConfig.emailVerification.enabled,
              }
            : undefined,

          // Configure session
          session: {
            expiresIn: authConfig.session.expiresIn || 604800,
            updateAge: authConfig.session.updateAge
              ? (authConfig.session.expiresIn || 604800) / 10
              : 0,
          },

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

          // Pass through any additional Better Auth plugins
          plugins: authConfig.betterAuthPlugins || [],
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
 * Get session from better-auth and transform it to OpenSaas session format
 * This is used internally by the generated context
 */
export async function getSessionFromAuth(
  auth: ReturnType<typeof betterAuth>,
  sessionFields: string[],
) {
  try {
    const session = await auth.api.getSession({
      headers: new Headers(),
    })

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
