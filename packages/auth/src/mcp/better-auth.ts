import type { McpProtectedRequestHandlerOptions } from '@better-auth/mcp'
import type { McpSession, McpSessionProvider } from '@opensaas/stack-core/mcp'

export type BetterAuthInstance = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth API types vary by plugins, must use any
  api: any
  handler: (request: Request) => Promise<Response>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Allows additional Better Auth instance properties
  [key: string]: any
}

export type BetterAuthMcpOptions = {
  /** The `resource` passed to Better Auth's `mcp()` plugin; the token audience. */
  resource: string
  /** Better Auth's base URL including its base path, e.g. `http://localhost:3000/api/auth`. */
  baseURL: string
  /** Expected token issuer. Defaults to `baseURL`. */
  issuer?: string
  /** The authorization server's JWKS URL. Defaults to `${baseURL}/jwks`. */
  jwksUrl?: string
  /** Scopes every accepted token must carry. */
  requiredScopes?: readonly string[]
}

function verificationOptions(options: BetterAuthMcpOptions): McpProtectedRequestHandlerOptions {
  const baseURL = options.baseURL.replace(/\/+$/, '')
  return {
    issuer: options.issuer ?? baseURL,
    audience: options.resource,
    jwksUrl: options.jwksUrl ?? `${baseURL}/jwks`,
    requiredScopes: options.requiredScopes,
  }
}

const REGISTERED_CLAIMS = ['iss', 'aud', 'nbf', 'iat', 'jti', 'azp', 'client_id', 'sid'] as const

function claimsToSession(
  claims: { sub?: string; scope?: unknown; exp?: number; [claim: string]: unknown },
  req: Request,
): McpSession | null {
  if (typeof claims.sub !== 'string' || claims.sub === '') return null
  const { sub, scope: _scope, exp: _exp, ...customClaims } = claims
  for (const claim of REGISTERED_CLAIMS) delete customClaims[claim]
  for (const claim of ['scopes', 'accessToken', 'expiresAt', 'userId']) delete customClaims[claim]
  const session: McpSession = { ...customClaims, userId: sub }
  if (typeof claims.scope === 'string') {
    session.scopes = claims.scope.split(' ').filter((scope) => scope !== '')
  }
  if (typeof claims.exp === 'number') session.expiresAt = new Date(claims.exp * 1000)
  const authorization = req.headers.get('authorization')
  if (authorization !== null) session.accessToken = authorization.replace(/^\S+\s+/, '')
  return session
}

async function verifyMcpRequest(
  options: BetterAuthMcpOptions,
  req: Request,
): Promise<{ session: McpSession } | { response: Response }> {
  const { createMcpProtectedRequestHandler } = await import('@better-auth/mcp')
  let session: McpSession | null = null
  const response = await createMcpProtectedRequestHandler(
    verificationOptions(options),
    (request, claims) => {
      session = claimsToSession(claims, request)
      if (session === null) {
        return new Response(null, {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
        })
      }
      return new Response(null, { status: 204 })
    },
  )(req)
  return session === null ? { response } : { session }
}

/**
 * Create the MCP session provider for a Better Auth `mcp()` authorization server.
 * The bearer token is verified against the JWKS for issuer, audience, expiry and
 * signature; revocation takes effect at token expiry.
 *
 * @example
 * ```typescript
 * import { createMcpHandlers } from '@opensaas/stack-core/mcp'
 * import { createBetterAuthMcpAdapter } from '@opensaas/stack-auth/mcp'
 * import config from '@/opensaas.config'
 * import { getContext } from '@/.opensaas/context'
 *
 * const { GET, POST, DELETE } = createMcpHandlers({
 *   config,
 *   getSession: createBetterAuthMcpAdapter({
 *     resource: 'http://localhost:3000/api/mcp',
 *     baseURL: 'http://localhost:3000/api/auth',
 *   }),
 *   getContext
 * })
 *
 * export { GET, POST, DELETE }
 * ```
 */
export function createBetterAuthMcpAdapter(options: BetterAuthMcpOptions): McpSessionProvider {
  return async (headers: Headers): Promise<McpSession | null> => {
    const result = await verifyMcpRequest(
      options,
      new Request(options.resource, { method: 'POST', headers }),
    )
    return 'session' in result ? result.session : null
  }
}

/**
 * Create MCP request handler with Better Auth OAuth authentication
 * Wraps an MCP handler to automatically authenticate and inject session.
 * Unauthenticated requests get Better Auth's RFC 9728 `WWW-Authenticate` challenge.
 *
 * @example
 * ```typescript
 * import { withMcpAuth } from '@opensaas/stack-auth/mcp'
 *
 * const handler = withMcpAuth(
 *   { resource: 'http://localhost:3000/api/mcp', baseURL: 'http://localhost:3000/api/auth' },
 *   async (req, session) => new Response(JSON.stringify({ userId: session.userId })),
 * )
 *
 * export { handler as GET, handler as POST, handler as DELETE }
 * ```
 */
export function withMcpAuth(
  options: BetterAuthMcpOptions,
  handler: (req: Request, session: McpSession) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const result = await verifyMcpRequest(options, req)
    if ('response' in result) return result.response
    return handler(req, result.session)
  }
}

/**
 * Convert MCP session to OpenSaaS context session
 * Allows using MCP session with OpenSaaS access control
 *
 * @example
 * ```typescript
 * const mcpSession = await createBetterAuthMcpAdapter(options)(req.headers)
 * const context = await getContext(mcpSessionToContextSession(mcpSession))
 * const posts = await context.db.Post.all()
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

const AUTHORIZATION_SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server'
const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'
const DEFAULT_AUTH_BASE_PATH = '/api/auth'

function metadataStatus(req: Request, rootPath: string, allowSuffix: boolean): 404 | 405 | null {
  const pathname = new URL(req.url).pathname.replace(/\/+$/, '')
  const matches = pathname === rootPath || (allowSuffix && pathname.startsWith(`${rootPath}/`))
  if (!matches) return 404
  if (req.method !== 'GET' && req.method !== 'HEAD') return 405
  return null
}

function statusResponse(status: 404 | 405): Response {
  return new Response(
    null,
    status === 405 ? { status, headers: { Allow: 'GET, HEAD' } } : { status },
  )
}

async function authBasePath(auth: BetterAuthInstance): Promise<string> {
  const context = await auth.$context
  const baseURL: unknown = context?.baseURL
  if (typeof baseURL !== 'string') return DEFAULT_AUTH_BASE_PATH
  return new URL(baseURL).pathname.replace(/\/+$/, '')
}

function inProcessRequest(req: Request, pathname: string): Request {
  return new Request(new URL(pathname, req.url), { method: req.method })
}

/**
 * Serves OAuth authorization server metadata for MCP clients at
 * `/.well-known/oauth-authorization-server`.
 *
 * The public metadata document is produced in-process by the Better Auth
 * instance: no outbound fetch is made, no inbound header is forwarded, and the
 * request's host selects no server. Only `GET`/`HEAD` are answered; any other
 * path is a `404`.
 *
 * @example
 * ```typescript
 * // app/.well-known/oauth-authorization-server/route.ts
 * export const GET = createOAuthDiscoveryHandler(auth)
 * ```
 */
export function createOAuthDiscoveryHandler(auth: BetterAuthInstance) {
  return async (req: Request): Promise<Response> => {
    const status = metadataStatus(req, AUTHORIZATION_SERVER_METADATA_PATH, false)
    if (status !== null) return statusResponse(status)
    const basePath = await authBasePath(auth)
    return auth.handler(inProcessRequest(req, `${AUTHORIZATION_SERVER_METADATA_PATH}${basePath}`))
  }
}

/**
 * Serves OAuth protected resource metadata (RFC 9728) for MCP clients at
 * `/.well-known/oauth-protected-resource`, including the resource-path variant.
 *
 * The public metadata document is produced in-process by the Better Auth
 * `mcp()` plugin: no outbound fetch is made, no inbound header is forwarded, and
 * the request's host selects no server. Only `GET`/`HEAD` are answered; any
 * other path is a `404`.
 *
 * @example
 * ```typescript
 * // app/.well-known/oauth-protected-resource/route.ts
 * export const GET = createOAuthProtectedResourceHandler(auth)
 * ```
 */
export function createOAuthProtectedResourceHandler(auth: BetterAuthInstance) {
  return async (req: Request): Promise<Response> => {
    const status = metadataStatus(req, PROTECTED_RESOURCE_METADATA_PATH, true)
    if (status !== null) return statusResponse(status)
    return auth.handler(inProcessRequest(req, new URL(req.url).pathname))
  }
}
