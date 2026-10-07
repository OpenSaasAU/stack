import { createOAuthDiscoveryHandler } from '@opensaas/stack-auth/mcp'
import { auth } from '@/lib/auth'

export const GET = createOAuthDiscoveryHandler(auth)
