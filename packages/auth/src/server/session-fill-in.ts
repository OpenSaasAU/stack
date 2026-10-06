import { getAuthTables } from 'better-auth/db'
import type { BetterAuthPlugin } from 'better-auth'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import type { UnsafeSurface } from '@opensaas/stack-core/unsafe'
import { authCollection } from '../adapter/surface.js'
import { buildBetterAuthTableOptions } from '../config/derive-auth-lists.js'
import type { NormalizedAuthConfig } from '../config/types.js'

export const SESSION_FILL_IN = Symbol.for('@opensaas/stack-auth/session-fill-in')

export interface SessionFillIn {
  readonly userFields: ReadonlySet<string>
  read(userId: string, fields: readonly string[]): Promise<Record<string, unknown> | null>
}

export function isSessionFillIn(value: unknown): value is SessionFillIn {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, 'userFields') instanceof Set &&
    typeof Reflect.get(value, 'read') === 'function'
  )
}

const EXCLUDED_FIELD_TYPES = new Set(['password'])

function userListScalarFields(config: OpenSaasConfig, userListKey: string): Set<string> {
  const fields = config.lists[userListKey]?.fields ?? {}
  return new Set(
    Object.entries(fields)
      .filter(([name, field]) => {
        if (EXCLUDED_FIELD_TYPES.has(field.type)) return false
        return field.getContractField?.(name, userListKey, config).kind === 'column'
      })
      .map(([name]) => name),
  )
}

function betterAuthUserFields(authConfig: NormalizedAuthConfig): Set<string> {
  const tables = getAuthTables(
    buildBetterAuthTableOptions(authConfig.models, authConfig.betterAuthPlugins),
  )
  return new Set(Object.keys(tables.user?.fields ?? {}))
}

function betterAuthSessionNames(authConfig: NormalizedAuthConfig): Set<string> {
  const tables = getAuthTables(
    buildBetterAuthTableOptions(authConfig.models, authConfig.betterAuthPlugins),
  )
  return new Set([
    'userId',
    'id',
    'user',
    'session',
    ...Object.keys(tables.user?.fields ?? {}),
    ...Object.keys(tables.session?.fields ?? {}),
  ])
}

function hasCustomSession(plugins: readonly BetterAuthPlugin[]): boolean {
  return plugins.some((plugin) => plugin.id === 'custom-session')
}

/**
 * Throws when a `sessionFields` entry resolves to nothing better-auth's session
 * or the user list carries. An app using `customSession` is exempt, since that
 * plugin replaces the session shape with names this check cannot see.
 */
export function assertSessionFieldsResolvable(
  config: OpenSaasConfig,
  authConfig: NormalizedAuthConfig,
): void {
  const userListKey = authConfig.models.user.modelName
  const fromBetterAuth = betterAuthSessionNames(authConfig)
  const userOwned = betterAuthUserFields(authConfig)
  const fromUserList = userListScalarFields(config, userListKey)
  const extended = Object.keys(authConfig.extendUserList.fields ?? {})
  const customSession = hasCustomSession(authConfig.betterAuthPlugins)

  for (const entry of authConfig.sessionFields) {
    if (extended.includes(entry) && userOwned.has(entry)) {
      throw new Error(
        `[@opensaas/stack-auth] sessionFields: "${entry}" is declared in \`extendUserList\` but ` +
          `better-auth's own user schema (core or a plugin such as \`admin()\`) already carries a ` +
          `field of that name, so the two collide. Remove it from \`extendUserList\` and let ` +
          `better-auth supply it, or rename the \`extendUserList\` field.`,
      )
    }
    if (fromBetterAuth.has(entry) || fromUserList.has(entry) || customSession) continue
    throw new Error(
      `[@opensaas/stack-auth] sessionFields: "${entry}" resolves to nothing. Looked in ` +
        `better-auth's session and user fields (${[...fromBetterAuth].join(', ')}) and in the ` +
        `scalar fields of the "${userListKey}" list (${[...fromUserList].join(', ') || 'none'}), ` +
        `which includes \`extendUserList\`.`,
    )
  }
}

export function createSessionFillIn(
  config: OpenSaasConfig,
  authConfig: NormalizedAuthConfig,
  unsafe: UnsafeSurface,
): SessionFillIn {
  const listKey = authConfig.models.user.modelName
  const listDb = config.lists[listKey]?.db
  const namespace = listDb?.schema ?? 'public'
  const userFields = userListScalarFields(config, listKey)

  return {
    userFields,
    async read(userId, fields) {
      return await authCollection(unsafe, namespace, listKey)
        .where((model) => model.id.eq(userId))
        .select(...fields)
        .first()
    },
  }
}
