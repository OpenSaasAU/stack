/**
 * @opensaas/stack-auth
 *
 * Better-auth integration for OpenSaaS Stack
 *
 * This package provides:
 * - Auto-generated User, Session, Account, Verification lists
 * - Session integration with OpenSaaS access control
 * - Pre-built auth UI components (SignIn, SignUp, ForgotPassword)
 * - Easy configuration with withAuth() wrapper
 *
 * @example
 * ```typescript
 * // opensaas.config.ts
 * import { config } from '@opensaas/stack-core'
 * import { withAuth, authConfig } from '@opensaas/stack-auth'
 *
 * export default withAuth(
 *   config({
 *     db: { provider: 'sqlite', url: 'file:./dev.db' },
 *     lists: { ... }
 *   }),
 *   authConfig({
 *     emailAndPassword: { enabled: true },
 *     emailVerification: { enabled: true },
 *   })
 * )
 * ```
 */

// Config exports
export { withAuth, authConfig, normalizeAuthConfig } from './config/index.js'
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
