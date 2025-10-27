/**
 * MCP API Route Handler
 * This route handles all MCP protocol requests with Better Auth OAuth authentication
 */

import { createMcpHandlers } from '@opensaas/stack-mcp'
import config from '@/opensaas.config'
import { auth } from '@/lib/auth'
import { getContext } from '@/.opensaas/context'

const { GET, POST, DELETE } = createMcpHandlers({
  config,
  auth,
  getContext,
})

export { GET, POST, DELETE }
