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

// Pure better-auth config -> Auth lists derivation (advanced use cases)
export { deriveAuthLists } from './config/derive-auth-lists.js'
export type { DerivedAuthLists } from './config/derive-auth-lists.js'

// "Adopt existing better-auth tables" recipe — sets the model/schema knobs that
// match a pre-existing separate-schema better-auth install so a migrating
// project reaches Schema parity without rebuilding the config by hand.
export { adoptBetterAuthTables } from './config/adopt-better-auth-tables.js'
export type {
  AdoptBetterAuthTablesOptions,
  AdoptBetterAuthTablesConfig,
} from './config/adopt-better-auth-tables.js'

// Runtime type exports
export type { AuthRuntimeServices } from './runtime/types.js'

// List generators (for advanced use cases)
export {
  getAuthLists,
  createUserList,
  createSessionList,
  createAccountList,
  createVerificationList,
} from './lists/index.js'
export type { ExtendUserListConfig } from './lists/index.js'
