/**
 * Auth configuration using stack-auth with MCP plugin
 */

import { createAuth, getSessionFromAuth } from '@opensaas/stack-auth/server'
import type { NormalizedAuthConfig } from '@opensaas/stack-auth'
import type { Session } from '@opensaas/stack-core'
import config from '../opensaas.config'
import { rawOpensaasContext } from '@/.opensaas/context'
import { headers } from 'next/headers'

/**
 * Auth server instance with MCP support
 */
export const auth = createAuth(config, rawOpensaasContext)

/**
 * Get the current session in OpenSaas format. `Session` is an open index
 * signature, so handing `getContext` better-auth's own session object instead
 * type-checks and then denies every access rule that reads `session.userId`.
 * Returns `null` for an anonymous visitor.
 */
export async function getSession(): Promise<Session | null> {
  const resolvedConfig = await config
  const authConfig = resolvedConfig._pluginData?.auth as NormalizedAuthConfig | undefined
  const sessionFields = authConfig?.sessionFields ?? ['userId', 'email', 'name']
  return getSessionFromAuth(auth, sessionFields, await headers())
}
