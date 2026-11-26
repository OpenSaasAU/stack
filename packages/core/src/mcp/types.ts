/**
 * MCP session type - auth-agnostic session information
 * Can be provided by any authentication system (better-auth, custom, etc.)
 */
export type McpSession = {
  /** The user the client acts for. It becomes the session's `userId` and the actor's `onBehalfOf`. */
  userId: string
  /**
   * The OAuth client id the provider verified, read from the credential's own
   * verified client identity and never from a custom claim. The handler
   * builds the session's agent actor from it and refuses a session without one.
   */
  clientId: string
  scopes?: string[]
  accessToken?: string
  expiresAt?: Date
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Allows additional session properties from auth providers
  [key: string]: any
}

/**
 * Session provider function type
 * Auth packages should implement this interface to integrate with MCP. It receives
 * a clone of the incoming request so a provider can check its method and URL.
 *
 * A provider must return the verified OAuth client id as `clientId`. A session
 * with no `clientId`, or with an empty one, is answered `401`. Any `actor` a
 * provider returns is discarded: the handler sets it.
 */
export type McpSessionProvider = (req: Request) => Promise<McpSession | null>
