/**
 * Better Auth MCP integration
 * OAuth authentication adapter for MCP servers
 */

export {
  createBetterAuthMcpAdapter,
  withMcpAuth,
  mcpSessionToContextSession,
  hasScopes,
  isSessionExpired,
  createOAuthDiscoveryHandler,
  createOAuthProtectedResourceHandler,
} from './better-auth.js'

export type { BetterAuthInstance } from './better-auth.js'
