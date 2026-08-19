import type { Plugin } from '@opensaas/stack-core/extend'
import { getDbKey } from '@opensaas/stack-core'
import type { AuthConfig, NormalizedAuthConfig } from './types.js'
import { normalizeAuthConfig } from './index.js'
import { getAuthLists } from '../lists/index.js'
import { convertBetterAuthSchema } from '../server/schema-converter.js'

/**
 * Auth plugin for OpenSaas Stack
 * Provides Better-auth integration with automatic list generation and session management
 *
 * @example
 * ```typescript
 * import { config } from '@opensaas/stack-core'
 * import { authPlugin } from '@opensaas/stack-auth'
 *
 * export default config({
 *   plugins: [
 *     authPlugin({
 *       emailAndPassword: { enabled: true },
 *       sessionFields: ['userId', 'email', 'name', 'role']
 *     })
 *   ],
 *   db: { provider: 'sqlite', url: 'file:./dev.db' },
 *   lists: { Post: list({...}) }
 * })
 * ```
 */
export function authPlugin(config: AuthConfig): Plugin {
  const normalized = normalizeAuthConfig(config)

  return {
    name: 'auth',
    version: '0.1.0',

    runtimeServiceTypes: {
      import: "import type { AuthRuntimeServices } from '@opensaas/stack-auth'",
      typeName: 'AuthRuntimeServices',
    },

    init: async (context) => {
      const authLists = getAuthLists(
        normalized.extendUserList,
        normalized.models,
        normalized.access,
      )

      // The same base-model list keys the Auth lists above were derived under
      // (e.g. `user.modelName: 'AuthUser'`). A provider plugin's schema
      // extension of a base model (e.g. `user`) must resolve against this
      // remap too, so it lands on the adopted Auth list rather than a
      // re-derived key that can collide with an unrelated host list. The
      // `rateLimit` key is only present when `rateLimit.storage: 'database'`
      // derived the fifth Auth list.
      const baseModelKeys = {
        user: normalized.models.user.modelName,
        session: normalized.models.session.modelName,
        account: normalized.models.account.modelName,
        verification: normalized.models.verification.modelName,
        ...(normalized.models.rateLimit
          ? { rateLimit: normalized.models.rateLimit.modelName }
          : {}),
      }

      // Add all auth lists FIRST, before any better-auth plugin schema
      // extension is processed. This must happen before the betterAuthPlugins
      // loop below so a base-model extension (e.g. a plugin's `schema: {
      // user: { fields: … } }`) always finds the real derived list already
      // registered under its key and takes the merge (`extendList`) path
      // against it — instead of pre-empting that key with a bare
      // `list({ fields })` that carries no `db`/`access` (see #861).
      for (const [listName, listConfig] of Object.entries(authLists)) {
        if (context.config.lists[listName]) {
          // A list already exists under this derived key — merge auth fields
          // in only. Access control belongs to whoever owns the list (the
          // application declared it first), so the plugin never forwards its
          // own access here — see ADR-0013.
          context.extendList(listName, {
            fields: listConfig.fields,
            hooks: listConfig.hooks,
            mcp: listConfig.mcp,
          })
        } else {
          context.addList(listName, listConfig)
        }
      }

      // Non-base plugin tables (e.g. `oauth_application`, `passkey`) register
      // as new lists via `addList`; a base-model schema extension merges via
      // `extendList` against the already-registered derived list (see the
      // ordering note above).
      for (const plugin of normalized.betterAuthPlugins) {
        if (plugin && typeof plugin === 'object' && plugin.schema) {
          const pluginSchema = plugin.schema
          const pluginLists = convertBetterAuthSchema(pluginSchema, baseModelKeys)

          for (const [listName, listConfig] of Object.entries(pluginLists)) {
            if (context.config.lists[listName]) {
              // Merge fields/hooks/mcp only — per ADR-0013 an extension must
              // never carry operation-level access for a pre-existing list
              // (the plugin engine throws if it does).
              context.extendList(listName, {
                fields: listConfig.fields,
                hooks: listConfig.hooks,
                mcp: listConfig.mcp,
              })
            } else {
              context.addList(listName, listConfig)
            }
          }
        }
      }

      context.setPluginData<NormalizedAuthConfig>('auth', normalized)
    },

    beforeGenerate: (generationConfig) => {
      const authSchemas = Array.from(
        new Set(
          Object.values(normalized.models)
            .map((model) => model.schema)
            .filter((schema): schema is string => Boolean(schema)),
        ),
      )

      if (authSchemas.length === 0) {
        return generationConfig
      }

      // Multi-schema Prisma requires the datasource to list every schema in use
      // AND every model to carry an `@@schema`. Merge the auth schema(s) into the
      // datasource `schemas` array (always including `public` for the app's own
      // lists), and default any list without an explicit `db.schema` to `public`
      // so the generated multi-schema schema is coherent and valid.
      const schemas = Array.from(
        new Set(['public', ...(generationConfig.db.schemas ?? []), ...authSchemas]),
      )

      const lists = Object.fromEntries(
        Object.entries(generationConfig.lists).map(([listKey, listConfig]) => {
          if (listConfig.db?.schema) {
            return [listKey, listConfig]
          }
          return [listKey, { ...listConfig, db: { ...listConfig.db, schema: 'public' } }]
        }),
      )

      return {
        ...generationConfig,
        db: { ...generationConfig.db, schemas },
        lists,
      }
    },

    runtime: (context, sudo) => {
      const userDbKey = getDbKey(normalized.models.user.modelName)

      return {
        /**
         * Resolves through `sudo()` (per ADR-0013): the User list ships
         * closed by default, and "who is this session" must not depend on
         * the application's User access policy.
         */
        getUser: async (userId: string) => {
          return await sudo().db[userDbKey].findUnique({
            where: { id: userId },
          })
        },

        /** See {@link getUser} — same `sudo()` rationale (ADR-0013), keyed off `context.session.userId`. */
        getCurrentUser: async () => {
          if (!context.session?.userId) {
            return null
          }
          return await sudo().db[userDbKey].findUnique({
            where: { id: context.session.userId },
          })
        },
      }
    },
  }
}
