/**
 * MCP session type - auth-agnostic session information
 * Can be provided by any authentication system (better-auth, custom, etc.)
 */
export type McpSession = {
  userId: string
  scopes?: string[]
  accessToken?: string
  expiresAt?: Date
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Allows additional session properties from auth providers
  [key: string]: any
}

/**
 * Session provider function type
 * Auth packages should implement this interface to integrate with MCP. It receives
 * the incoming request so a provider can check its method and URL; do not read the
 * body, which the handler consumes afterwards.
 */
export type McpSessionProvider = (req: Request) => Promise<McpSession | null>
