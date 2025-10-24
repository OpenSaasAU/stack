import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import type { BetterAuthOptions } from 'better-auth'
import type { OpenSaaSConfig, DatabaseConfig, AccessContext } from '@opensaas/framework-core'
import type { NormalizedAuthConfig } from '../config/types.js'

/**
 * Get better-auth database configuration from OpenSaaS config
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
 * Create a better-auth instance from OpenSaaS config
 * This should be called once at app startup
 *
 * @example
 * ```typescript
 * // lib/auth.ts
 * import { createAuth } from '@opensaas/framework-auth/server'
 * import config from '../opensaas.config'
 *
 * export const auth = createAuth(config)
 * ```
 */
export function createAuth(
  opensaasConfig: OpenSaaSConfig & { __authConfig?: NormalizedAuthConfig },
  context: AccessContext,
) {
  // Extract auth config (added by withAuth)
  const authConfig = opensaasConfig.__authConfig

  if (!authConfig) {
    throw new Error(
      'Auth config not found. Make sure to wrap your config with withAuth() in opensaas.config.ts',
    )
  }

  // Build better-auth configuration
  const betterAuthConfig: BetterAuthOptions = {
    database: getDatabaseConfig(opensaasConfig.db, context),

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
      updateAge: authConfig.session.updateAge ? (authConfig.session.expiresIn || 604800) / 10 : 0,
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
  }

  return betterAuth(betterAuthConfig)
}

/**
 * Get session from better-auth and transform it to OpenSaaS session format
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
