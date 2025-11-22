/**
 * Session type augmentation for OpenSaas Stack
 *
 * This file defines the shape of the session object used throughout the application.
 * The session fields should match the sessionFields configuration in opensaas.config.ts
 *
 * Note: In practice, session objects may have subset of these fields depending on context.
 * Mark fields as optional if they may not always be present.
 */

import '@opensaas/stack-core'

declare module '@opensaas/stack-core' {
  interface Session {
    /**
     * User ID (maps to User.id)
     */
    userId?: string

    /**
     * User's email address
     */
    email?: string

    /**
     * User's display name
     */
    name?: string
  }
}
