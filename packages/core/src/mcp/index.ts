/**
 * MCP (Model Context Protocol) integration for OpenSaaS Stack
 * Auth-agnostic MCP server runtime
 */

export { createMcpHandlers } from './handler.js'
export type { McpSession, McpSessionProvider } from './types.js'
export { McpToolError } from './tool-error.js'
