import type { McpSession, McpSessionProvider } from '@opensaas/stack-core/mcp'

export type BetterAuthInstance = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth API types vary by plugins, must use any
  api: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Allows additional Better Auth instance properties
  [key: string]: any
}

/**
 * Create Better Auth MCP session adapter
 * Converts Better Auth instance into MCP session provider
 *
 * @example
 * ```typescript
 * import { createMcpHandlers } from '@opensaas/stack-core/mcp'
 * import { createBetterAuthMcpAdapter } from '@opensaas/stack-auth/mcp'
 * import config from '@/opensaas.config'
 * import { auth } from '@/lib/auth'
 * import { getContext } from '@/.opensaas/context'
 *
 * const { GET, POST, DELETE } = createMcpHandlers({
 *   config,
 *   getSession: createBetterAuthMcpAdapter(auth),
 *   getContext
 * })
 *
 * export { GET, POST, DELETE }
 * ```
 */
export function createBetterAuthMcpAdapter(auth: BetterAuthInstance): McpSessionProvider {
  return async (headers: Headers): Promise<McpSession | null> => {
    return await auth.api.getMcpSession({ headers })
  }
}

/**
 * Create MCP request handler with Better Auth OAuth authentication
 * Wraps an MCP handler to automatically authenticate and inject session
 *
 * @example
 * ```typescript
 * import { withMcpAuth } from '@opensaas/stack-auth/mcp'
 * import { auth } from '@/lib/auth'
 *
 * const handler = withMcpAuth(auth, async (req, session) => {
 *   // session.userId is authenticated — handle the MCP request
 *   return new Response(JSON.stringify({ ok: true }))
 * })
 *
 * export { handler as GET, handler as POST, handler as DELETE }
 * ```
 */
export function withMcpAuth(
  auth: BetterAuthInstance,
  handler: (req: Request, session: McpSession) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const session = await auth.api.getMcpSession({
      headers: req.headers,
    })

    if (!session) {
      return new Response(null, {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Bearer realm="MCP", error="invalid_token"',
        },
      })
    }

    return handler(req, session)
  }
}

/**
 * Convert MCP session to OpenSaaS context session
 * Allows using MCP session with OpenSaaS access control
 *
 * @example
 * ```typescript
 * const mcpSession = await auth.api.getMcpSession({ headers: req.headers })
 * const context = await getContext(mcpSessionToContextSession(mcpSession))
 * const posts = await context.db.post.findMany()
 * ```
 */
export function mcpSessionToContextSession(mcpSession: McpSession): { userId: string } {
  return {
    userId: mcpSession.userId,
  }
}

/**
 * Validate MCP session scopes
 * Check if session has required OAuth scopes
 *
 * @example
 * ```typescript
 * if (!hasScopes(session, ['read:posts', 'write:posts'])) {
 *   return new Response('Insufficient scopes', { status: 403 })
 * }
 * ```
 */
export function hasScopes(session: McpSession, requiredScopes: string[]): boolean {
  if (!session.scopes) return false
  return requiredScopes.every((scope) => session.scopes!.includes(scope))
}

export function isSessionExpired(session: McpSession): boolean {
  if (!session.expiresAt) return false
  return new Date() > session.expiresAt
}

/**
 * Exposes OAuth authorization server metadata for MCP clients.
 *
 * Place at `/.well-known/oauth-authorization-server/route.ts`. Better Auth
 * already handles `/api/auth/.well-known/oauth-authorization-server`, but
 * some clients may fail to parse the `WWW-Authenticate` header.
 */
export function createOAuthDiscoveryHandler(_auth: BetterAuthInstance) {
  return async (req: Request) => {
    const authPath = '/api/auth/.well-known/oauth-authorization-server'
    const authUrl = new URL(authPath, req.url)

    return fetch(authUrl.toString(), {
      headers: req.headers,
    })
  }
}

/**
 * Exposes OAuth protected resource metadata for MCP clients.
 *
 * Place at `/.well-known/oauth-protected-resource/route.ts`.
 */
export function createOAuthProtectedResourceHandler(_auth: BetterAuthInstance) {
  return async (req: Request) => {
    const authPath = '/api/auth/.well-known/oauth-protected-resource'
    const authUrl = new URL(authPath, req.url)

    return fetch(authUrl.toString(), {
      headers: req.headers,
    })
  }
}
