import { createAuth, getSessionFromAuth } from '@opensaas/stack-auth/server'
import type { NormalizedAuthConfig } from '@opensaas/stack-auth'
import type { Session } from '@opensaas/stack-core'
import config from '../opensaas.config'
import { headers } from 'next/headers'
import { rawOpensaasContext } from '@/.opensaas/context'

/**
 * Better-auth server instance
 * This handles all authentication on the server side
 */
export const auth = createAuth(config, rawOpensaasContext)

/**
 * Get the current session in OpenSaas format. Reads `sessionFields` from the
 * resolved config at runtime, so changing it doesn't require regenerating
 * this file.
 */
export async function getSession(): Promise<Session | null> {
  const resolvedConfig = await config
  const authConfig = resolvedConfig._pluginData?.auth as NormalizedAuthConfig | undefined
  const sessionFields = authConfig?.sessionFields ?? ['userId', 'email', 'name']
  return getSessionFromAuth(auth, sessionFields, await headers())
}

/**
 * Get the raw Better Auth session (full object with session and user)
 * Use this when you need access to Better Auth-specific properties
 */
export async function getBetterAuthSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })
  return session
}

/**
 * Export auth handlers for API routes
 */
export const GET = auth.handler
export const POST = auth.handler
