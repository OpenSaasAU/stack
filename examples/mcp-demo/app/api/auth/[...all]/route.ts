/**
 * Better Auth API routes
 * Handles all authentication endpoints including MCP OAuth
 */

import { auth } from '@/lib/auth'

export const GET = auth.handler
export const POST = auth.handler
