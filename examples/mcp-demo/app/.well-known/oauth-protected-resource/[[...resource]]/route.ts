import { createOAuthProtectedResourceHandler } from '@opensaas/stack-auth/mcp'
import { auth } from '@/lib/auth'

export const GET = createOAuthProtectedResourceHandler(auth)
