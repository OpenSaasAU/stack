import { listIdColumn } from '@opensaas/stack-core'
import type { Plugin } from '@opensaas/stack-core/extend'
import type { AuthConfig, NormalizedAuthConfig } from './types.js'
import { normalizeAuthConfig } from './index.js'
import { getAuthLists } from '../lists/index.js'

/**
 * The id strategy every Auth list mints: an explicit `authPlugin({ idField })`
 * wins, else the app's own `db.idField` default — the same fallback chain
 * `resolveIdStrategy` (`packages/core/src/contract/derive.ts`) computes for
 * any other list — else `'uuid7'`. Reimplemented here rather than imported
 * because core doesn't re-export it; if that fallback chain ever changes,
 * this copy needs to follow it. Never `'int autoincrement'`: the Auth
 * adapter treats every id as a string (ADR-0048, ADR-0060), so an app whose
 * own global default is `'int autoincrement'` must opt the Auth lists into a
 * string strategy explicitly.
 */
function resolveAuthIdField(
  idField: NormalizedAuthConfig['idField'],
  appDefault: 'uuid7' | 'cuid2' | 'int autoincrement' | undefined,
): 'uuid7' | 'cuid2' {
  const resolved = idField ?? appDefault ?? 'uuid7'
  if (resolved === 'int autoincrement') {
    throw new Error(
      "[@opensaas/stack-auth] the Auth lists cannot use `db.idField: 'int autoincrement'` — " +
        "better-auth's adapter treats every id as a string (ADR-0048, ADR-0060), and the app's " +
        `own \`db.idField\` default resolves to "int autoincrement". Pass ` +
        "`authPlugin({ idField: 'uuid7' })` or `authPlugin({ idField: 'cuid2' })` to pick a " +
        'string strategy for just the Auth lists.',
    )
  }
  return resolved
}

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
        normalized.fieldAccess,
      )

      // ADR-0048's per-list pin, named for the Auth lists: an explicit
      // `authPlugin({ idField })` wins, else the Auth lists inherit the app's
      // own `db.idField` default like any other list (#1239) — so an app
      // already on a non-uuid7 default (adopting a live install whose ids are
      // text, say) keeps its Auth lists on it without a separate override.
      const idField = resolveAuthIdField(normalized.idField, context.config.db.idField)

      // Base models are always the first entries in `authLists` (see
      // `deriveAuthLists`), so a plugin table's reverse relation onto a base
      // model (e.g. `AuthUser.oauthApplications`) is already part of that
      // base list's `fields` by the time this loop reaches it — one pass
      // suffices for both: a list already declared by the app (or added by
      // an earlier iteration of this same loop) merges via `extendList`;
      // everything else registers via `addList`.
      for (const [listName, derived] of Object.entries(authLists)) {
        const listConfig = { ...derived, db: { ...derived.db, idField } }
        if (context.config.lists[listName]) {
          // A list already exists under this derived key. `extendList` never
          // touches `db` (the application owns it, same as `access` —
          // ADR-0013), so this list mints ids however its OWN `db.idField`
          // resolves — which must agree with the strategy above, or the
          // adapter's declared id capabilities (see `opensaasAuthAdapter`)
          // would contradict what one of the two branches actually emits.
          const existingIdField = listIdColumn(context.config, listName)?.strategy
          if (existingIdField !== idField) {
            throw new Error(
              `[@opensaas/stack-auth] "${listName}" already exists (declared by the application, ` +
                `or by another plugin that ran before authPlugin) with its own \`db.idField\` ` +
                `resolving to "${existingIdField}", but authPlugin's Auth lists resolve to ` +
                `"${idField}". Both must mint ids the same way — set "${listName}"'s own ` +
                `\`db.idField\` to "${idField}", or pass \`authPlugin({ idField: ` +
                `'${existingIdField}' })\` if that is 'uuid7' or 'cuid2'.`,
            )
          }

          // Merge auth fields in only. Access control belongs to whoever owns
          // the list (the application declared it first), so the plugin never
          // forwards its own access here — see ADR-0013.
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

      // The contract's multi-schema support requires every namespace in use to be
      // declared AND every model in a non-default namespace to name it. Merge the
      // auth schema(s) into `db.schemas` (always including `public` for the app's
      // own lists), and default any list without an explicit `db.schema` to
      // `public` so the generated contract's namespaces are coherent and valid.
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
          return await sudo().db[userDbKey].where({ id: userId }).first()
        },

        /** See {@link getUser} — same `sudo()` rationale (ADR-0013), keyed off `context.session.userId`. */
        getCurrentUser: async () => {
          if (!context.session?.userId) {
            return null
          }
          return await sudo().db[userDbKey].where({ id: context.session.userId }).first()
        },
      }
    },
  }
}
