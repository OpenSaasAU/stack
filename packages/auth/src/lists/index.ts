import type { ListConfig, FieldConfig } from '@opensaas/stack-core'
import type { NormalizedAuthModels } from '../config/types.js'
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
   * Access control for the User list
   * If not provided, defaults to basic access control (users can update their own records)
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
 * Create the base User list with better-auth required fields.
 *
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
 * Get all auth lists required by better-auth.
 *
 * Derives the Auth lists from the resolved better-auth model config. When no
 * `models` are supplied (or none carry overrides), the result is the historical
 * default set keyed `User`/`Session`/`Account`/`Verification`.
 *
 * @param userConfig - Extra User-list fields/access/hooks (from `extendUserList`)
 * @param models - Resolved better-auth model config; defaults to the better-auth defaults
 */
export function getAuthLists(
  userConfig?: ExtendUserListConfig,
  models: NormalizedAuthModels = DEFAULT_MODELS,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
): Record<string, ListConfig<any>> {
  return deriveAuthLists(models, userConfig || {}).lists
}
