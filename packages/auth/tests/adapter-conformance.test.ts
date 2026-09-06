// better-auth's own adapter conformance suites, run against the stack-authored
// Auth adapter over the Test context's in-process Postgres (ADR-0057,
// ADR-0060). Upstream's definition of correct, run against our translation: a
// better-auth release that adds another mandatory method fails a test here
// rather than a login in production.

import {
  caseInsensitiveTestSuite,
  enableJoinTests,
  normalTestSuite,
  testAdapter,
  uuidTestSuite,
} from '@better-auth/test-utils/adapter'
import { randomUUID } from 'node:crypto'
import { getAuthTables } from 'better-auth/db'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import { config as defineConfig } from '@opensaas/stack-core'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth'
import type { DBFieldAttribute } from 'better-auth/db'
import { authPlugin } from '../src/config/plugin.js'
import { getAuthListRegistry } from '../src/lists/index.js'
import type { NormalizedAuthConfig } from '../src/config/types.js'
import { opensaasAuthAdapter } from '../src/adapter/index.js'
import type { AuthConfig, AuthModelConfig } from '../src/config/types.js'

// numberId is not run: the Auth lists are string-keyed by construction —
// `authPlugin` pins `db.idField: 'uuid7'` on every list it injects, and the
// adapter declares `supportsNumericIds: false` (ADR-0048, ADR-0060).
//
// joins is not run: the adapter implements no joins, and
// `advanced.database.joins` is refused at config time rather than left to
// better-auth's silent per-model fallback (ADR-0060). See
// `passthrough-keys.test.ts` for the refusal.

/**
 * Tests the adapter does not answer to, and why.
 *
 * - Every `join` test: the adapter implements none, and the flag that would
 *   turn better-auth's own fallback on is refused at config time (ADR-0060).
 * - `generateId`: the database mints every auth id, so an app-supplied
 *   generator is ignored here and refused at config time (ADR-0048).
 * - The issuer-scoped account key: better-auth declares that `@@unique`
 *   table-level, which `deriveAuthLists` does not yet emit (#986). A schema
 *   gap, not an adapter one — and a production one, stated as a known limit on
 *   `opensaasAuthAdapter` rather than only here.
 * - The nullable foreign key: a `deriveAuthLists` gap tracked as
 *   [#1222](https://github.com/OpenSaasAU/stack/issues/1222), not an adapter
 *   one.
 */
const NOT_IMPLEMENTED: Record<string, boolean> = {
  ...Object.fromEntries(Object.keys(enableJoinTests).map((name) => [name, true])),
  'create - should use generateId if provided': true,
  'create - should enforce the issuer-scoped account identity key': true,
  'create - should return null for nullable foreign keys': true,
}

/**
 * The suite's own "no such row" probes, which are unrunnable against a `uuid`
 * id column outside the `uuid` suite.
 *
 * Each hardcodes the id `"100000"` unless the running options say
 * `advanced.database.generateId: 'uuid'` — the key production refuses — and
 * Postgres rejects a malformed uuid outright rather than answering not-found.
 * The `uuid` suite declares that key itself and runs them; the shipped
 * configuration's own versions, with a well-formed id, are in
 * `adapter-behaviour.test.ts`.
 */
const HARDCODED_NON_UUID_ID: Record<string, boolean> = {
  'findOne - should not throw on record not found': true,
  'findMany - should return an empty array when no models are found': true,
  'delete - should not throw on record not found': true,
}

const BASE_MODELS = ['user', 'session', 'account', 'verification'] as const

type BaseModel = (typeof BASE_MODELS)[number]

function modelOptionsOf(options: BetterAuthOptions, model: BaseModel): AuthModelConfig {
  const declared = options[model]
  const modelName = declared && 'modelName' in declared ? declared.modelName : undefined
  const fields = declared && 'fields' in declared ? declared.fields : undefined
  return {
    ...(modelName !== undefined ? { tableName: modelName } : {}),
    ...(fields !== undefined ? { fields } : {}),
  }
}

/**
 * better-auth's `additionalFields`, as a plugin's own schema extension.
 *
 * `deriveAuthLists` reads better-auth's resolved tables through the model
 * config and the plugin list; `additionalFields` reaches `getAuthTables` only
 * through `options`, which the derivation does not take. A plugin's `schema`
 * merges into the same resolved tables, so this is the seam that carries the
 * suite's ad-hoc columns into the generated schema.
 */
function additionalFieldsPlugin(options: BetterAuthOptions): BetterAuthPlugin | undefined {
  const schema: Record<string, { fields: Record<string, DBFieldAttribute> }> = {}
  for (const model of BASE_MODELS) {
    const declared = options[model]
    const additional =
      declared && 'additionalFields' in declared ? declared.additionalFields : undefined
    if (additional && Object.keys(additional).length > 0) {
      schema[model] = { fields: { ...additional } }
    }
  }
  if (Object.keys(schema).length === 0) return undefined
  return { id: 'conformance-additional-fields', schema }
}

function authConfigFor(options: BetterAuthOptions): AuthConfig {
  const plugins = [...(options.plugins ?? [])]
  const additional = additionalFieldsPlugin(options)
  if (additional) plugins.push(additional)

  return {
    emailAndPassword: { enabled: true },
    betterAuthPlugins: plugins,
    user: modelOptionsOf(options, 'user'),
    session: modelOptionsOf(options, 'session'),
    account: modelOptionsOf(options, 'account'),
    verification: modelOptionsOf(options, 'verification'),
  }
}

async function opensaasConfigFor(options: BetterAuthOptions): Promise<OpenSaasConfig> {
  return await defineConfig({
    plugins: [authPlugin(authConfigFor(options))],
    db: { provider: 'postgresql' },
    lists: {},
  })
}

/**
 * What the schema depends on, and nothing else.
 *
 * The suites call `modifyBetterAuthOptions(options, false)` for changes that
 * must NOT wipe the rows already inserted, so the database is rebuilt only
 * when the resolved tables actually differ.
 */
function schemaFingerprint(options: BetterAuthOptions): string {
  const tables = getAuthTables(options)
  return JSON.stringify(
    Object.entries(tables)
      .map(([key, table]) => [
        key,
        table.modelName,
        Object.entries(table.fields)
          .map(([field, attributes]) => [
            field,
            attributes.fieldName ?? field,
            attributes.type,
            attributes.required ?? true,
            attributes.unique ?? false,
            attributes.references?.model ?? null,
          ])
          .sort(),
      ])
      .sort(),
  )
}

let database: TestDatabase | undefined
let opensaasConfig: OpenSaasConfig | undefined
let fingerprint: string | undefined

async function standUp(options: BetterAuthOptions): Promise<void> {
  const next = schemaFingerprint(options)
  if (database !== undefined && next === fingerprint) return

  const built = await opensaasConfigFor(options)
  const rebuilt = await createTestDatabase(built)
  await database?.close()
  database = rebuilt
  opensaasConfig = built
  fingerprint = next
}

await testAdapter({
  adapter: async (options) => {
    await standUp(options)
    const current = database
    const built = opensaasConfig
    if (!current || !built) throw new Error('The conformance database was not stood up.')
    const normalized = built._pluginData?.auth as NormalizedAuthConfig
    const context = current.context()
    return opensaasAuthAdapter({
      config: built,
      unsafe: context.unsafe,
      registry: getAuthListRegistry(normalized.models, normalized.betterAuthPlugins),
      transaction: (body) => context.transaction((tx) => body(tx.unsafe)),
    })
  },
  runMigrations: async (options) => {
    await standUp(options)
  },
  // The Auth lists' ids are `uuid7` columns (ADR-0048), so the suite's own
  // fixtures have to mint UUIDs rather than better-auth's default nanoid, and
  // its "no such row" probes have to use a well-formed id — Postgres rejects a
  // malformed one outright rather than answering not-found. This is the whole
  // of what the fixtures need: `advanced.database.generateId` is the key
  // `assertNoUnsupportedPassthroughKeys` refuses, so setting it here would run
  // every assertion against a configuration no shipped app can have — and a
  // different branch of better-auth's own `initGetIdField` from the one
  // production takes. The `uuid` suite declares that key itself, upstream, as
  // the mode it exists to exercise.
  customIdGenerator: () => randomUUID(),
  onFinish: async () => {
    await database?.close()
    database = undefined
    fingerprint = undefined
  },
  tests: [
    normalTestSuite({ disableTests: { ...NOT_IMPLEMENTED, ...HARDCODED_NON_UUID_ID } }),
    uuidTestSuite({ disableTests: NOT_IMPLEMENTED }),
    caseInsensitiveTestSuite(),
  ],
}).then((suite) => suite.execute())
