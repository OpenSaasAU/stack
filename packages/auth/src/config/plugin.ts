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
      // Derive the auth lists from the better-auth model config (modelName +
      // field column maps). With no overrides this yields the historical
      // User/Session/Account/Verification keys; with overrides (e.g.
      // user.modelName: 'AuthUser') the lists are keyed and column-mapped to
      // match the developer's live better-auth tables.
      const authLists = getAuthLists(normalized.extendUserList, normalized.models)

      // Extract additional lists from Better Auth plugins
      for (const plugin of normalized.betterAuthPlugins) {
        if (plugin && typeof plugin === 'object' && 'schema' in plugin) {
          // Plugin has schema property - convert to OpenSaaS lists
          const pluginSchema = plugin.schema
          const pluginLists = convertBetterAuthSchema(pluginSchema)

          // Add or extend lists from plugin
          for (const [listName, listConfig] of Object.entries(pluginLists)) {
            if (context.config.lists[listName]) {
              // List exists, extend it
              context.extendList(listName, {
                fields: listConfig.fields,
                hooks: listConfig.hooks,
                access: listConfig.access,
                mcp: listConfig.mcp,
              })
            } else {
              // List doesn't exist, add it
              context.addList(listName, listConfig)
            }
          }
        }
      }

      // Add all auth lists.
      //
      // The plugin only ever touches its OWN derived keys. When a developer
      // renames the auth user model (e.g. user.modelName: 'AuthUser'), the
      // derived key is 'AuthUser' and an app's separate 'User' list is left
      // untouched — the plugin never extends/overwrites a list it didn't
      // derive. Extending only kicks in when an existing list shares the
      // derived key (e.g. the default 'User'), which is the intended
      // "merge auth fields into my User" behaviour.
      for (const [listName, listConfig] of Object.entries(authLists)) {
        if (context.config.lists[listName]) {
          // A list already exists under this derived key — merge auth fields in.
          context.extendList(listName, {
            fields: listConfig.fields,
            hooks: listConfig.hooks,
            access: listConfig.access,
            mcp: listConfig.mcp,
          })
        } else {
          // Otherwise, add the auth list
          context.addList(listName, listConfig)
        }
      }

      // Store auth config for runtime access
      // Access at runtime via: config._pluginData.auth
      context.setPluginData<NormalizedAuthConfig>('auth', normalized)
    },

    beforeGenerate: (generationConfig) => {
      // Collect every schema the Auth lists are placed in (per-model schema,
      // else the plugin-level schema). When none is configured the Auth lists
      // stay in the default `public` schema and we leave the config untouched —
      // the greenfield default Prisma schema is unchanged (no `schemas`, no
      // `previewFeatures`, no `@@schema`).
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

    runtime: (context) => {
      // Resolve the user list's context.db key from the configured user model.
      // context.db is keyed camelCase, so 'User' -> 'user', 'AuthUser' -> 'authUser'.
      const userDbKey = getDbKey(normalized.models.user.modelName)

      // Provide auth-related utilities at runtime
      return {
        /**
         * Get user by ID
         * Uses the access-controlled context to fetch user data
         */
        getUser: async (userId: string) => {
          return await context.db[userDbKey].findUnique({
            where: { id: userId },
          })
        },

        /**
         * Get current user from session
         * Extracts userId from session and fetches user data
         */
        getCurrentUser: async () => {
          if (!context.session?.userId) {
            return null
          }
          return await context.db[userDbKey].findUnique({
            where: { id: context.session.userId },
          })
        },
      }
    },
  }
}
