// `@opensaas/stack-core/client`, kept for one minor release (issue #2432).

import {
  resolveRuntimeConnection as resolveRuntimeConnectionFromDbClient,
  type RuntimeConnectionOptions as RuntimeConnectionOptionsFromDbClient,
} from './client.js'

/**
 * @deprecated Import `resolveRuntimeConnection` from `@opensaas/stack-core/db-client`.
 * `@opensaas/stack-core/client` is removed at the next major.
 */
export const resolveRuntimeConnection = resolveRuntimeConnectionFromDbClient

/**
 * @deprecated Import `RuntimeConnectionOptions` from `@opensaas/stack-core/db-client`.
 * `@opensaas/stack-core/client` is removed at the next major.
 */
export type RuntimeConnectionOptions = RuntimeConnectionOptionsFromDbClient
