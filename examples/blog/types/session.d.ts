/**
 * Session type augmentation for OpenSaas Stack
 *
 * The shape of the session object the access control helpers in
 * `opensaas.config.ts` read. This example wires in no auth provider — a session
 * is whatever `getContext({ userId })` is handed — so `userId` is the only
 * field it declares.
 */

import '@opensaas/stack-core'

declare module '@opensaas/stack-core' {
  interface Session {
    /**
     * User ID (maps to User.id)
     */
    userId?: string
  }
}
