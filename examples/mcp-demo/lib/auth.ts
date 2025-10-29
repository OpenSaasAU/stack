/**
 * Auth configuration using stack-auth with MCP plugin
 */

import { createAuth } from '@opensaas/stack-auth/server'
import config from '../opensaas.config'
import { rawOpensaasContext } from '@/.opensaas/context'
import { headers } from 'next/headers'

/**
 * Auth server instance with MCP support
 */
export const auth = createAuth(config, rawOpensaasContext)

/**
 * Get the current session
 */
export async function getAuth() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })
  return session
}
