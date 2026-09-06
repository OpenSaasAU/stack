import type { Plugin } from '@opensaas/stack-core/extend'
import type { AuthConfig, NormalizedAuthConfig } from './types.js'
import { normalizeAuthConfig } from './index.js'
import { getAuthLists } from '../lists/index.js'

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
      // One consolidated derivation covers the four base models, the
      // optional RateLimit model, and every table a better-auth plugin
      // declares in its own `schema` (base-model extensions like the
      // `anonymous` plugin's `user.isAnonymous`, and standalone tables like
      // the MCP plugin's OAuth tables) — see `deriveAuthLists` (issue #992).
      // `getAuthTables` merges a plugin's base-model schema extension
      // directly into that model's own fields, so the derived `User`/`AuthUser`
      // list here already carries e.g. `isAnonymous` before this loop runs.
      const authLists = getAuthLists(
        normalized.extendUserList,
        normalized.models,
        normalized.access,
        normalized.betterAuthPlugins,
        normalized.credentialFields,
      )

      // Base models are always the first entries in `authLists` (see
      // `deriveAuthLists`), so a plugin table's reverse relation onto a base
      // model (e.g. `AuthUser.oauthApplications`) is already part of that
      // base list's `fields` by the time this loop reaches it — one pass
      // suffices for both: a list already declared by the app (or added by
      // an earlier iteration of this same loop) merges via `extendList`;
      // everything else registers via `addList`.
      for (const [listName, derived] of Object.entries(authLists)) {
        // ADR-0048's per-list pin, named for the Auth lists: every id the
        // adapter hands better-auth is minted by the database, and it is the
        // same strategy every other list gets.
        const listConfig = { ...derived, db: { ...derived.db, idField: 'uuid7' as const } }
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
      const userDbKey = normalized.models.user.modelName

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
