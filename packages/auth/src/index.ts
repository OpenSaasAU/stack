/**
 * @opensaas/stack-auth — Better-auth integration for OpenSaas Stack.
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

export { normalizeAuthConfig } from './config/index.js'
export { authPlugin } from './config/plugin.js'
export type { AuthConfig, NormalizedAuthConfig } from './config/index.js'
export type * from './config/types.js'

// Pure better-auth config -> Auth lists derivation (advanced use cases)
export { deriveAuthLists } from './config/derive-auth-lists.js'
export type { DerivedAuthLists } from './config/derive-auth-lists.js'

// "Adopt existing better-auth tables" recipe — presets the model/schema knobs
// for a pre-existing separate-schema better-auth install (advanced use case).
export { adoptBetterAuthTables } from './config/adopt-better-auth-tables.js'
export type {
  AdoptBetterAuthTablesOptions,
  AdoptBetterAuthTablesConfig,
} from './config/adopt-better-auth-tables.js'

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
