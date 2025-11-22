import { createAuth } from '@opensaas/stack-auth/server'
import config from '../opensaas.config'
import { headers } from 'next/headers'
import { rawOpensaasContext } from '@/.opensaas/context'

/**
 * Better-auth server instance
 * This handles all authentication on the server side
 */
export const auth = createAuth(config, rawOpensaasContext)

/**
 * Get the current session in OpenSaas format
 * Extracts configured sessionFields from Better Auth session
 */
export async function getSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })
  return {
    userId: session?.user?.id,
    email: session?.user?.email,
    name: session?.user?.name,
  }
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
