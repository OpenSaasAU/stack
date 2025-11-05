/**
 * @opensaas/stack-auth
 *
 * Better-auth integration for OpenSaas Stack
 *
 * This package provides:
 * - Auto-generated User, Session, Account, Verification lists
 * - Session integration with OpenSaas access control
 * - Pre-built auth UI components (SignIn, SignUp, ForgotPassword)
 * - Easy configuration with authPlugin()
 *
 * @example
 * ```typescript
 * // opensaas.config.ts
 * import { config } from '@opensaas/stack-core'
 * import { authPlugin } from '@opensaas/stack-auth'
 *
 * export default config({
 *   plugins: [
 *     authPlugin({
 *       emailAndPassword: { enabled: true },
 *       emailVerification: { enabled: true },
 *     })
 *   ],
 *   db: { provider: 'sqlite', url: 'file:./dev.db' },
 *   lists: { ... }
 * })
 * ```
 */

// Config exports
export { normalizeAuthConfig } from './config/index.js'
export { authPlugin } from './config/plugin.js'
export type { AuthConfig, NormalizedAuthConfig } from './config/index.js'
export type * from './config/types.js'

// List generators (for advanced use cases)
export {
  getAuthLists,
  createUserList,
  createSessionList,
  createAccountList,
  createVerificationList,
} from './lists/index.js'
export type { ExtendUserListConfig } from './lists/index.js'
