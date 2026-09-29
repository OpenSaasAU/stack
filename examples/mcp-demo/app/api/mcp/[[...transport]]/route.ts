/**
 * MCP API Route Handler
 * This route handles all MCP protocol requests with Better Auth OAuth authentication
 */

import { createMcpHandlers } from '@opensaas/stack-core/mcp'
import { createBetterAuthMcpAdapter } from '@opensaas/stack-auth/mcp'
import config from '@/opensaas.config'
import { getContext } from '@/.opensaas/context'

const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

const { GET, POST, DELETE } = createMcpHandlers({
  config: await config,
  getSession: createBetterAuthMcpAdapter({
    resource: `${appUrl}/api/mcp`,
    baseURL: `${appUrl}/api/auth`,
  }),
  getContext,
})

export { GET, POST, DELETE }
