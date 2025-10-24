'use client'

import { createAuthClient } from 'better-auth/react'
import type { Session } from 'better-auth/types'

/**
 * Create a better-auth client for use in React components
 * This should be called once and the result exported
 *
 * @example
 * ```typescript
 * // lib/auth-client.ts
 * 'use client'
 * import { createClient } from '@opensaas/framework-auth/client'
 *
 * export const authClient = createClient({
 *   baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
 * })
 * ```
 */
export function createClient(options: { baseURL: string }): ReturnType<typeof createAuthClient> {
  return createAuthClient({
    baseURL: options.baseURL,
  })
}

/**
 * Re-export useful types from better-auth
 */
export type { Session }

/**
 * Note: React hooks (useSession, etc.) are accessed from the client instance
 *
 * @example
 * ```typescript
 * import { authClient } from '@/lib/auth-client'
 *
 * function MyComponent() {
 *   const { data: session } = authClient.useSession()
 *   // ...
 * }
 * ```
 */
