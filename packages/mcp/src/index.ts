/**
 * OpenSaaS Stack MCP Integration
 * Provides MCP server capabilities with Better Auth OAuth authentication
 */

// Runtime - main API
export { createMcpHandlers } from './runtime/index.js'

// Auth utilities
export {
  mcpSessionToContextSession,
  hasScopes,
  isSessionExpired,
  createOAuthDiscoveryHandler,
  createOAuthProtectedResourceHandler,
} from './auth/index.js'
export type { McpSession, BetterAuthInstance } from './auth/index.js'
