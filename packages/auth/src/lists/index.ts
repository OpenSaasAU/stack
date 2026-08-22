import type { ListConfig, FieldConfig } from '@opensaas/stack-core'
import type { BetterAuthPlugin } from 'better-auth'
import type { AuthAccessConfig, NormalizedAuthModels } from '../config/types.js'
import { deriveAuthLists } from '../config/derive-auth-lists.js'

/**
 * Configuration for extending the auto-generated User list
 */
export type ExtendUserListConfig = {
  /**
   * Additional fields to add to the User list
   * You can add custom fields beyond the basic better-auth fields
   */
  fields?: Record<string, FieldConfig>
  /**
   * Access control for the User list.
   *
   * Per ADR-0013, if neither this nor `authPlugin({ access: { user: … } })` is
   * provided, the User list is **closed** (deny-by-default) — it no longer
   * defaults to permissive access. Takes precedence over `access.user` when
   * both are set.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  access?: ListConfig<any>['access']
  /**
   * Hooks for the User list
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  hooks?: ListConfig<any>['hooks']
}

/**
 * The default better-auth model config (no `modelName`/`fields` overrides).
 * Produces the historical `User`/`Session`/`Account`/`Verification` keys with
 * their original field shapes. Used by the backwards-compatible
 * `createUserList`/`getAuthLists` helpers.
 */
const DEFAULT_MODELS: NormalizedAuthModels = {
  user: { modelName: 'User', fields: {} },
  session: { modelName: 'Session', fields: {} },
  account: { modelName: 'Account', fields: {} },
  verification: { modelName: 'Verification', fields: {} },
}

/**
 * Backwards-compatible helper: derives the default `User` list (keyed `User`,
 * default field shapes) via {@link deriveAuthLists}.
 */
export function createUserList(
  config?: ExtendUserListConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
): ListConfig<any> {
  return deriveAuthLists(DEFAULT_MODELS, config).lists.User
}

/**
 * Create the Session list for better-auth (default `Session` key).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
export function createSessionList(): ListConfig<any> {
  return deriveAuthLists(DEFAULT_MODELS).lists.Session
}

/**
 * Create the Account list for better-auth (default `Account` key).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
export function createAccountList(): ListConfig<any> {
  return deriveAuthLists(DEFAULT_MODELS).lists.Account
}

/**
 * Create the Verification list for better-auth (default `Verification` key).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
export function createVerificationList(): ListConfig<any> {
  return deriveAuthLists(DEFAULT_MODELS).lists.Verification
}

/**
 * Get all auth lists required by better-auth — the four base models, an
 * optional database-backed `RateLimit`, and any table a better-auth plugin
 * declares in its own `schema` (issue #992).
 *
 * Derives the Auth lists from the resolved better-auth model config. When no
 * `models` are supplied (or none carry overrides), the result is the historical
 * default set keyed `User`/`Session`/`Account`/`Verification`.
 *
 * @param userConfig - Extra User-list fields/access/hooks (from `extendUserList`)
 * @param models - Resolved better-auth model config; defaults to the better-auth defaults
 * @param accessConfig - App-authored access for each base Auth list, keyed by better-auth model name
 * @param plugins - The app's better-auth plugins (`authPlugin({ betterAuthPlugins })`)
 */
export function getAuthLists(
  userConfig?: ExtendUserListConfig,
  models: NormalizedAuthModels = DEFAULT_MODELS,
  accessConfig?: AuthAccessConfig,
  plugins?: BetterAuthPlugin[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
): Record<string, ListConfig<any>> {
  return deriveAuthLists(models, userConfig || {}, accessConfig || {}, plugins || []).lists
}
