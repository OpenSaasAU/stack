/**
 * Better Auth integration exports
 */

export {
  withMcpAuth,
  mcpSessionToContextSession,
  hasScopes,
  isSessionExpired,
  createOAuthDiscoveryHandler,
  createOAuthProtectedResourceHandler,
} from './better-auth.js'

export type { McpSession, BetterAuthInstance } from './better-auth.js'
