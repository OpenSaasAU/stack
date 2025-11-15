import type { Plugin } from '@opensaas/stack-core'
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
      // Get auth lists from base Better Auth schema
      const authLists = getAuthLists(normalized.extendUserList)

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

      // Add all auth lists
      for (const [listName, listConfig] of Object.entries(authLists)) {
        if (context.config.lists[listName]) {
          // If user defined a User list, extend it with auth fields
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

    runtime: (context) => {
      // Provide auth-related utilities at runtime
      return {
        /**
         * Get user by ID
         * Uses the access-controlled context to fetch user data
         */
        getUser: async (userId: string) => {
          // Use 'authUser' if custom User list name was provided, otherwise 'user'
          const userListKey = 'user' // TODO: Make this configurable based on list name
          return await context.db[userListKey].findUnique({
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
          const userListKey = 'user'
          return await context.db[userListKey].findUnique({
            where: { id: context.session.userId },
          })
        },
      }
    },
  }
}
