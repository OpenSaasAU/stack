'use client'

import { createClient } from '@opensaas/stack-auth/client'

/**
 * Better-auth client instance
 * Use this in your React components to access auth state and methods
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
export const authClient = createClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
})
