/**
 * Better Auth integration for MCP OAuth authentication
 * Provides session handling and authentication utilities
 */

/**
 * MCP session extracted from Better Auth access token
 */
export type McpSession = {
  userId: string
  scopes?: string[]
  accessToken?: string
  expiresAt?: Date
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Allows additional session properties from Better Auth plugins
  [key: string]: any
}

/**
 * Better Auth instance type (flexible)
 * Uses minimal typing to avoid tight coupling with better-auth package
 */
export type BetterAuthInstance = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth API types vary by plugins, must use any
  api: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Allows additional Better Auth instance properties
  [key: string]: any
}

/**
 * Create MCP request handler with Better Auth OAuth authentication
 * Wraps an MCP handler to automatically authenticate and inject session
 *
 * @example
 * ```typescript
 * import { withMcpAuth } from '@opensaas/stack-mcp/auth'
 * import { auth } from '@/lib/auth'
 * import { createMcpServer } from '@/.opensaas/mcp/server'
 *
 * const handler = withMcpAuth(auth, async (req, session) => {
 *   const server = createMcpServer(session)
 *   return server.handleRequest(req)
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
    // Extract MCP session from Better Auth
    const session = await auth.api.getMcpSession({
      headers: req.headers,
    })

    if (!session) {
      // Return 401 with WWW-Authenticate header for OAuth clients
      return new Response(null, {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Bearer realm="MCP", error="invalid_token"',
        },
      })
    }

    // Call handler with authenticated session
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
 * const context = getContext(mcpSessionToContextSession(mcpSession))
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

/**
 * Check if MCP session is expired
 */
export function isSessionExpired(session: McpSession): boolean {
  if (!session.expiresAt) return false
  return new Date() > session.expiresAt
}

/**
 * Create OAuth discovery metadata handler
 * Exposes OAuth authorization server metadata for MCP clients
 *
 * This should be placed at `/.well-known/oauth-authorization-server/route.ts`
 * Better Auth already handles `/api/auth/.well-known/oauth-authorization-server`
 * but some clients may fail to parse WWW-Authenticate headers
 */
export function createOAuthDiscoveryHandler(_auth: BetterAuthInstance) {
  return async (req: Request) => {
    // Delegate to Better Auth's built-in handler
    const authPath = '/api/auth/.well-known/oauth-authorization-server'
    const authUrl = new URL(authPath, req.url)

    return fetch(authUrl.toString(), {
      headers: req.headers,
    })
  }
}

/**
 * Create OAuth protected resource metadata handler
 * Exposes OAuth protected resource metadata for MCP clients
 *
 * This should be placed at `/.well-known/oauth-protected-resource/route.ts`
 */
export function createOAuthProtectedResourceHandler(_auth: BetterAuthInstance) {
  return async (req: Request) => {
    // Delegate to Better Auth's built-in handler
    const authPath = '/api/auth/.well-known/oauth-protected-resource'
    const authUrl = new URL(authPath, req.url)

    return fetch(authUrl.toString(), {
      headers: req.headers,
    })
  }
}
