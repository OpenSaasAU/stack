/**
 * `better-auth config → Auth lists` derivation, free of side effects and
 * plugin/runtime concerns. Reads better-auth's own resolved table
 * definitions (`getAuthTables`, re-exported from `better-auth/db`) rather
 * than hand-transcribing them, so the Auth lists cannot silently drift from
 * what better-auth itself declares (issue #987). This single derivation also
 * covers better-auth *plugin* tables (e.g. the MCP plugin's OAuth tables) —
 * `getAuthTables` merges a plugin's own `schema` into its result when
 * `options.plugins` is populated, so one registry and one field-derivation
 * pass cover base models and plugin tables alike (issue #992). See
 * `packages/auth/CLAUDE.md` ("Deriving Auth lists from better-auth config")
 * for the full behavior and examples.
 */

import { list } from '@opensaas/stack-core'
import {
  text,
  timestamp,
  checkbox,
  integer,
  bigInt,
  relationship,
} from '@opensaas/stack-core/fields'
import { getAuthTables } from 'better-auth/db'
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth'
import type { DBFieldAttribute } from 'better-auth/db'
import type { ListConfig, FieldConfig, ListIndex, FieldAccess } from '@opensaas/stack-core'
import type { RelationshipField } from '@opensaas/stack-core/fields'
import type { ExtendUserListConfig } from '../lists/index.js'
import type { AuthAccessConfig, NormalizedAuthModelConfig, NormalizedAuthModels } from './types.js'

/**
 * The derived Auth list set together with the keys each of the five base
 * better-auth models was placed under. Keys are surfaced separately so
 * callers (plugin add-vs-extend logic, runtime user-key resolution) don't
 * have to re-derive them. Better-auth *plugin* tables (e.g. `oauthApplication`)
 * are derived alongside these but aren't named here — their keys are only
 * needed internally, to resolve a reference target, and by callers that just
 * want every derived list (`Object.keys(lists)`).
 */
export type DerivedAuthLists = {
  keys: {
    user: string
    session: string
    account: string
    verification: string
    /** Only present when a `RateLimit` list was derived (`rateLimit.storage === 'database'`). */
    rateLimit?: string
  }
  /** The derived list configs, keyed by their derived list keys — base models and plugin tables alike. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  lists: Record<string, ListConfig<any>>
}

/** better-auth's own fixed base model keys — independent of the stack's list-key overrides (`modelName`). Every other key `getAuthTables` returns is a plugin table. */
type BaseModelKey = 'user' | 'session' | 'account' | 'verification' | 'rateLimit'
const BASE_MODEL_KEYS: readonly BaseModelKey[] = [
  'user',
  'session',
  'account',
  'verification',
  'rateLimit',
]

/**
 * Declared field order for each of the five base models, independent of the
 * order `getAuthTables` happens to return fields in. Prisma doesn't care
 * about field order, but pinning it keeps the generated schema stable across
 * this change (and future better-auth releases) instead of reshuffling on
 * every regenerate — the reverse relations (`user.sessions`/`user.accounts`)
 * are appended after these, in the order their owning model is processed
 * below. A plugin table has no entry here — `assembleFields` falls back to
 * upstream field order for any model this table doesn't list, which is every
 * plugin table.
 */
const FIELD_ORDER: Partial<Record<BaseModelKey, string[]>> = {
  user: ['name', 'email', 'emailVerified', 'image'],
  session: ['token', 'expiresAt', 'ipAddress', 'userAgent', 'user'],
  account: [
    'accountId',
    'providerId',
    // `issuer` (better-auth 1.7+, issue #986) groups with accountId/providerId
    // as the account's identity fields — together the table-level
    // `@@unique([issuer, accountId])` better-auth declares (not yet emitted;
    // blocked on #986 reading better-auth's own table-level `indexes` through
    // the app-supplied `db.indexes` passthrough #985 adds).
    'issuer',
    'user',
    'accessToken',
    'refreshToken',
    'accessTokenExpiresAt',
    'refreshTokenExpiresAt',
    'scope',
    'idToken',
    'password',
  ],
  verification: ['identifier', 'value', 'expiresAt'],
  rateLimit: ['key', 'count', 'lastRequest'],
}

/** Carried via list-level `db.timestamps` (see `listDb`) rather than as ordinary derived fields. */
const TIMESTAMP_FIELDS = new Set(['createdAt', 'updatedAt'])

/**
 * Fields that hold a live, presentable credential — reading the value is
 * equivalent to holding it (session hijack, account takeover, replaying an
 * OAuth token) — rather than merely identifying a row. Keyed by better-auth's
 * own model/field keys, not the app's list/column names, so the deny holds
 * under `modelName` and column `fields` remapping alike (ADR-0036).
 *
 * Covers the four base models plus every better-auth plugin table the stack
 * has first-class support for (ADR-0034's registry of known plugins) — the
 * `mcp`/oauth-provider plugin's client secret and token columns, and
 * `twoFactor()`'s encrypted secret/backup codes (issue #1014). An app can
 * mark further fields via `authPlugin({ credentialFields })`, merged in by
 * {@link buildCredentialFieldRegistry} — this constant is never mutated.
 */
const CREDENTIAL_FIELDS: Record<string, readonly string[]> = {
  session: ['token'],
  verification: ['value'],
  account: ['password', 'accessToken', 'refreshToken', 'idToken'],
  oauthClient: ['clientSecret'],
  oauthAccessToken: ['token'],
  oauthRefreshToken: ['token'],
  twoFactor: ['secret', 'backupCodes'],
}

const DENY_READ: FieldAccess = { read: () => false }

/** Every better-auth model/field key marked as a credential — the stack's own {@link CREDENTIAL_FIELDS} plus an app's `credentialFields`. */
type CredentialFieldRegistry = Record<string, ReadonlySet<string>>

/**
 * Merges the stack-seeded {@link CREDENTIAL_FIELDS} with an app's
 * `authPlugin({ credentialFields })`, then validates every entry against the
 * models actually being derived (`tables`, keyed by better-auth model key).
 *
 * Additive only: an app entry can add fields to a model — including a
 * stack-seeded one — but nothing can remove a seeded field, so a config that
 * omits or empties a seeded model's list leaves that model's seeded deny
 * standing.
 *
 * A field named on a model that isn't in `tables` at all (a plugin the app
 * doesn't use) is a silent no-op — the entry simply never matches anything.
 * A field named on a model that IS in `tables` but doesn't declare that field
 * throws, naming the model and field, since that is a config mistake the app
 * would otherwise never learn about (the deny would just never fire).
 */
function buildCredentialFieldRegistry(
  tables: Record<string, ResolvedTable>,
  appConfig: Record<string, string[]>,
): CredentialFieldRegistry {
  const merged = new Map<string, Set<string>>()
  for (const [modelKey, fields] of Object.entries(CREDENTIAL_FIELDS)) {
    merged.set(modelKey, new Set(fields))
  }
  for (const [modelKey, fields] of Object.entries(appConfig)) {
    const set = merged.get(modelKey) ?? new Set<string>()
    for (const fieldKey of fields) set.add(fieldKey)
    merged.set(modelKey, set)
  }

  const registry: CredentialFieldRegistry = {}
  for (const [modelKey, fields] of merged) {
    const table = tables[modelKey]
    if (!table) continue // model not derived (plugin unused) -> silent no-op
    for (const fieldKey of fields) {
      if (!(fieldKey in table.fields)) {
        throw new Error(
          `deriveAuthLists: credentialFields names "${modelKey}.${fieldKey}", but "${modelKey}" has no field "${fieldKey}"`,
        )
      }
    }
    registry[modelKey] = fields
  }
  return registry
}

function withCredentialAccess(
  registry: CredentialFieldRegistry,
  modelKey: string,
  fieldKey: string,
  field: FieldConfig,
): FieldConfig {
  if (!registry[modelKey]?.has(fieldKey)) return field
  return { ...field, access: DENY_READ }
}

/**
 * Whether a model declares BOTH `createdAt` and `updatedAt` upstream — the
 * only shape `db.timestamps: true` can express, since it always emits both
 * columns together (`resolveListTimestamps` in the Prisma generator). The
 * four base models always satisfy this. A better-auth plugin table is not
 * guaranteed to: the MCP plugin's OAuth tables (better-auth 1.7, issue #992)
 * include several with only `createdAt` (e.g. `oauthAccessToken`,
 * `oauthRefreshToken`, `oauthClientResource`) — those fall through to the
 * general field-derivation loop below instead, so `createdAt` alone is still
 * derived as an ordinary scalar column rather than silently dropped (which
 * previously crashed a real write the moment better-auth's own adapter tried
 * to set it — see `oauthResource`'s seeded row in the MCP OAuth cascade e2e
 * test).
 */
function hasSymmetricTimestamps(upstreamFields: Record<string, DBFieldAttribute>): boolean {
  return 'createdAt' in upstreamFields && 'updatedAt' in upstreamFields
}

/**
 * The reverse relation field name a foreign key implies on its target model
 * (e.g. `User.sessions`) has no source in better-auth's metadata at all —
 * `references` declares only the child→parent link, never a name for the
 * parent's reverse collection. Derived by pluralizing the child model's own
 * key, which reproduces every current name; override here for a collision or
 * a bad pluralization, one entry per better-auth model key (base or plugin).
 */
const REVERSE_RELATION_NAME_OVERRIDES: Partial<Record<string, string>> = {}

function pluralize(word: string): string {
  if (/[sxz]$|[cs]h$/.test(word)) return `${word}es`
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`
  return `${word}s`
}

function reverseRelationName(modelKey: string): string {
  return REVERSE_RELATION_NAME_OVERRIDES[modelKey] ?? pluralize(modelKey)
}

/**
 * The relationship field name a foreign key column derives to (e.g. `userId`
 * → `user`) — better-auth models the column as a plain scalar carrying
 * `references`; the stack models the same column as a `relationship()` under
 * a different key. Stripping a trailing `Id` is the naming convention
 * better-auth's own FK columns (and the stack's prior hand-written lists)
 * already follow.
 */
function relationshipFieldName(upstreamFieldKey: string): string {
  return upstreamFieldKey.endsWith('Id') ? upstreamFieldKey.slice(0, -2) : upstreamFieldKey
}

const ON_DELETE_ACTIONS: Record<string, string> = {
  cascade: 'Cascade',
  restrict: 'Restrict',
  'set null': 'SetNull',
  'set default': 'SetDefault',
  'no action': 'NoAction',
}

function mapOnDelete(action: string): string {
  return ON_DELETE_ACTIONS[action] ?? 'Cascade'
}

/**
 * PascalCase a better-auth `modelName`, preserving internal word boundaries.
 * Base models never go through this — their list key is always the
 * configured `modelName` as-is (see `buildModelRegistry`) — only plugin
 * tables do, since better-auth plugins declare camelCase (`oauthApplication`)
 * or snake_case (`oauth_application`) model names and list keys must be
 * PascalCase (issue #991).
 */
function pascalCaseModelName(modelName: string): string {
  if (/[_-]/.test(modelName)) {
    return modelName
      .split(/[_-]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('')
  }
  return modelName.charAt(0).toUpperCase() + modelName.slice(1)
}

function scalarIsIndexed(upstream: DBFieldAttribute): true | 'unique' | undefined {
  if (upstream.unique) return 'unique'
  if (upstream.index) return true
  return undefined
}

/**
 * The OpenSaaS field keys an app-supplied `db.indexes` entry (ADR-0035)
 * claims on this model — every field named in any entry's `fields` array,
 * regardless of that entry's own arity or uniqueness. A claimed column's
 * derived `isIndexed` (from better-auth's own `unique`/`index` flags) is
 * suppressed so only the app's entry is emitted; suppression is per-column,
 * so a composite entry claiming `identifier` leaves every other derived
 * index on the model untouched.
 */
function claimedIndexFields(indexes: ListIndex[]): Set<string> {
  const claimed = new Set<string>()
  for (const index of indexes) {
    for (const fieldRef of index.fields) {
      claimed.add(typeof fieldRef === 'string' ? fieldRef : fieldRef.field)
    }
  }
  return claimed
}

/**
 * `db.isNullable` is set explicitly from `required` rather than left to each
 * field builder's own default — `timestamp()` in particular defaults nullable
 * off of whether it carries a `now()` default, not off requiredness, so
 * leaving it implicit would silently produce a nullable column for a
 * required upstream date field. `db.map` is set only when the resolved
 * column name differs from the field's own key, so an unmodified field
 * doesn't grow a redundant `@map`.
 */
function scalarFieldDb(
  fieldKey: string,
  upstream: DBFieldAttribute,
): { isNullable: boolean; map?: string } {
  const columnName = upstream.fieldName ?? fieldKey
  return {
    isNullable: !(upstream.required ?? true),
    ...(columnName !== fieldKey ? { map: columnName } : {}),
  }
}

function buildScalarField(
  fieldKey: string,
  upstream: DBFieldAttribute,
  suppressIndex: boolean,
): FieldConfig {
  const isRequired = upstream.required ?? true
  const isIndexed = suppressIndex ? undefined : scalarIsIndexed(upstream)
  const db = scalarFieldDb(fieldKey, upstream)

  switch (upstream.type) {
    case 'string': {
      const staticDefault =
        typeof upstream.defaultValue === 'function' ? undefined : upstream.defaultValue
      return text({
        ...(isRequired ? { validation: { isRequired: true as const } } : {}),
        ...(isIndexed ? { isIndexed } : {}),
        ...(staticDefault !== undefined ? { defaultValue: staticDefault as string } : {}),
        db,
      })
    }
    case 'boolean': {
      const staticDefault =
        typeof upstream.defaultValue === 'function' ? undefined : upstream.defaultValue
      return checkbox({
        ...(isIndexed ? { isIndexed } : {}),
        ...(staticDefault !== undefined ? { defaultValue: staticDefault as boolean } : {}),
        db,
      })
    }
    case 'date':
      return timestamp({ ...(isIndexed ? { isIndexed } : {}), db })
    case 'number': {
      const staticDefault =
        typeof upstream.defaultValue === 'function' ? undefined : upstream.defaultValue
      return upstream.bigint
        ? bigInt({
            ...(isRequired ? { validation: { isRequired: true as const } } : {}),
            ...(isIndexed ? { isIndexed } : {}),
            ...(staticDefault !== undefined ? { defaultValue: staticDefault as number } : {}),
            db,
          })
        : integer({
            ...(isRequired ? { validation: { isRequired: true as const } } : {}),
            ...(isIndexed ? { isIndexed } : {}),
            ...(staticDefault !== undefined ? { defaultValue: staticDefault as number } : {}),
            db,
          })
    }
    default:
      // better-auth's `DBFieldType` also allows `json`, `string[]`/`number[]`,
      // and an enum array — none of which any built-in plugin (MCP, admin,
      // organization, two-factor, ...) or the four base models actually use
      // today. Warn and fall back to a plain `text()` column rather than
      // throwing, so an app config that happens to hit this still generates
      // (matching the pre-consolidation plugin-table converter's behavior)
      // instead of crashing the whole `config()`/`generate` pipeline.
      console.warn(
        `[stack-auth] Unknown better-auth field type "${upstream.type}" for field "${fieldKey}", defaulting to text field`,
      )
      return text({
        ...(isRequired ? { validation: { isRequired: true as const } } : {}),
        ...(isIndexed ? { isIndexed } : {}),
        db,
      })
  }
}

/**
 * Build the `relationship()` field for a foreign-key column (e.g.
 * `Session.user`), mirroring better-auth's own FK shape exactly: the
 * physical column always maps explicitly to better-auth's resolved column
 * name (even when it equals the field name — leaving it conditional would
 * let the generator's Keystone-parity default take over and map to the
 * relationship field name instead, reintroducing issue #935), requiredness
 * and `onDelete` come from `references`, and the FK index/uniqueness mirror
 * better-auth's own `index`/`unique` flags (ADR-0007).
 *
 * Only called for a reference whose target field is the target's `id` — see
 * the field-derivation loop in {@link deriveAuthLists} for the non-PK case
 * (e.g. better-auth's own oidc-provider schema references
 * `oauthApplication.clientId`, not its `id`), which `relationship()` cannot
 * express and stays a plain scalar column instead.
 */
function buildForeignKeyField(
  fieldKey: string,
  upstream: DBFieldAttribute,
  targetListKey: string,
  reverseFieldName: string,
  suppressIndex: boolean,
): RelationshipField {
  const references = upstream.references
  if (!references) {
    throw new Error(
      `deriveAuthLists: "${fieldKey}" was routed as a foreign key but has no references`,
    )
  }

  const isRequired = upstream.required ?? true
  const columnName = upstream.fieldName ?? fieldKey
  const onDelete = mapOnDelete(references.onDelete ?? 'cascade')
  // A relationship field's own generator defaults its FK index to indexed
  // (true) whenever `isIndexed` is *omitted*, unlike a scalar field — so
  // suppression can't just drop the property here the way `buildScalarField`
  // does; it must set `isIndexed: false` explicitly to actually turn the
  // derived index off.
  const isIndexed = suppressIndex ? (false as const) : scalarIsIndexed(upstream)

  return relationship({
    ref: `${targetListKey}.${reverseFieldName}`,
    ...(isIndexed !== undefined ? { isIndexed } : {}),
    db: {
      isNullable: !isRequired,
      foreignKey: { map: columnName },
      extendPrismaSchema: ({ fkLine, relationLine }) => ({
        fkLine,
        relationLine: relationLine.replace('@relation(', `@relation(onDelete: ${onDelete}, `),
      }),
    },
  })
}

/**
 * Build the list-level `db` config (`timestamps` + `@@map` + `@@schema`) for
 * a derived base-model list.
 *
 * `timestamps` is a per-model input, not hardcoded: better-auth's adapter
 * writes `createdAt`/`updatedAt` on every user/session/account/verification
 * row, so those four opt back into auto-timestamps now that they're OFF by
 * default (ADR-0004). The `RateLimit` model has neither column upstream, so
 * it passes `false`. Plugin tables don't go through this — see the "Out of
 * scope" note on `deriveAuthLists` about not adding fields/behavior
 * better-auth doesn't declare a JS-level default for.
 */
function listDb(
  model: NormalizedAuthModelConfig,
  timestamps: boolean,
): { timestamps?: true; map?: string; schema?: string; indexes?: ListIndex[] } {
  const schema = model.schema
  const indexes = model.indexes
  return {
    ...(timestamps ? { timestamps: true as const } : {}),
    ...(model.tableName !== undefined ? { map: model.tableName } : {}),
    ...(schema !== undefined ? { schema } : {}),
    ...(indexes && indexes.length > 0 ? { indexes } : {}),
  }
}

function betterAuthModelOptions(model: NormalizedAuthModelConfig): {
  fields: Record<string, string>
} {
  return { fields: model.fields }
}

/**
 * The options object fed to `getAuthTables` — carries the per-model column
 * overrides the app configured, plus the app's better-auth plugins so their
 * own `schema` (base-model extensions and standalone plugin tables alike)
 * merges into the same resolved table set (issue #992).
 */
function buildBetterAuthTableOptions(
  models: NormalizedAuthModels,
  plugins: BetterAuthPlugin[],
): BetterAuthOptions {
  return {
    user: betterAuthModelOptions(models.user),
    session: betterAuthModelOptions(models.session),
    account: betterAuthModelOptions(models.account),
    verification: betterAuthModelOptions(models.verification),
    ...(models.rateLimit
      ? { rateLimit: { storage: 'database' as const, ...betterAuthModelOptions(models.rateLimit) } }
      : {}),
    ...(plugins.length ? { plugins } : {}),
  }
}

/** A resolved better-auth table definition, as `getAuthTables` returns it (base model or plugin table alike). */
type ResolvedTable = { modelName: string; fields: Record<string, DBFieldAttribute> }

/**
 * The model registry: every better-auth model key (base or plugin) mapped to
 * its derived list key. Built in one pass over `getAuthTables`' full result,
 * before any field is derived — reference resolution needs a target's
 * derived list key, and a reference can cross from a plugin table to a base
 * model, from a plugin table to another plugin table, or (for the base
 * models themselves) to another base model, so the whole set has to be known
 * up front rather than resolved lazily per model.
 *
 * Base models keep their existing behavior: the list key is exactly the
 * configured `modelName` (already assumed PascalCase by convention, not
 * re-cased here). A plugin table's list key is PascalCased from its resolved
 * `modelName` (issue #991) — `getAuthTables` always resolves a plugin
 * table's `modelName` (defaulting to its own schema key when the plugin
 * doesn't set one), so this is never applied to an empty string.
 */
function buildModelRegistry(
  tables: Record<string, ResolvedTable>,
  models: NormalizedAuthModels,
): { keys: DerivedAuthLists['keys']; registry: Map<string, string> } {
  const keys: DerivedAuthLists['keys'] = {
    user: models.user.modelName,
    session: models.session.modelName,
    account: models.account.modelName,
    verification: models.verification.modelName,
    ...(models.rateLimit ? { rateLimit: models.rateLimit.modelName } : {}),
  }

  const registry = new Map<string, string>()
  for (const baseKey of BASE_MODEL_KEYS) {
    const listKey = keys[baseKey]
    if (listKey) registry.set(baseKey, listKey)
  }

  for (const modelKey of Object.keys(tables)) {
    if (registry.has(modelKey)) continue
    registry.set(modelKey, pascalCaseModelName(tables[modelKey].modelName))
  }

  return { keys, registry }
}

/**
 * Derive the OpenSaaS Auth lists from the resolved better-auth model config —
 * the four base models, an optional database-backed `RateLimit`, and any
 * table a better-auth plugin declares in its own `schema` (issue #992).
 *
 * Per ADR-0013 every derived list ships **closed** (no permissive operation
 * access) unless the application supplies access via `accessConfig` (the
 * `authPlugin({ access: … })` passthrough, keyed by better-auth model name) or,
 * for the user list specifically, `userConfig.access` (`extendUserList.access`,
 * which takes precedence — see {@link AuthAccessConfig}). Plugin tables have no
 * `access` passthrough at all — an app that needs to grant access declares the
 * list itself under the same derived key so this function's field-only merge
 * (in `authPlugin`'s add-vs-extend loop) leaves the app's own access standing.
 *
 * A fifth `RateLimit` list is included only when `models.rateLimit` is
 * present (i.e. `rateLimit.storage === 'database'`).
 *
 * Each base model's `indexes` (`AuthModelConfig.indexes`) carries through to
 * the derived list's `db.indexes` unchanged, and suppresses this function's
 * own derived field-level `isIndexed` for any column an entry names — the
 * application's declaration wins over a derived default (ADR-0035).
 *
 * @param models - Resolved better-auth per-model config (modelName + field column maps + app-supplied indexes)
 * @param userConfig - Extra User-list fields/access/hooks supplied via `extendUserList`
 * @param accessConfig - App-authored access for each base Auth list, keyed by better-auth model name
 * @param plugins - The app's better-auth plugins (`authPlugin({ betterAuthPlugins })`), whose own
 *   `schema` (base-model extensions and standalone plugin tables) is derived alongside the base models
 * @param credentialFieldsConfig - App-authored additions to the credential-field read-deny
 *   (`authPlugin({ credentialFields })`), keyed by better-auth model key. Additive only — see
 *   {@link buildCredentialFieldRegistry}.
 * @returns The derived base-model list keys and every derived list config (base models and plugin tables)
 */
export function deriveAuthLists(
  models: NormalizedAuthModels,
  userConfig: ExtendUserListConfig = {},
  accessConfig: AuthAccessConfig = {},
  plugins: BetterAuthPlugin[] = [],
  credentialFieldsConfig: Record<string, string[]> = {},
): DerivedAuthLists {
  const tables = getAuthTables(buildBetterAuthTableOptions(models, plugins)) as Record<
    string,
    ResolvedTable
  >
  const { keys, registry } = buildModelRegistry(tables, models)
  const credentialRegistry = buildCredentialFieldRegistry(tables, credentialFieldsConfig)

  // Only the five base models carry an app-authored `db.indexes` passthrough
  // (`AuthModelConfig.indexes`) — plugin tables have no per-model config
  // block to declare them through (deliberately out of scope, see the issue
  // brief). Computed once per model rather than per field.
  const claimedFieldsByModel: Partial<Record<BaseModelKey, Set<string>>> = {}
  for (const baseKey of BASE_MODEL_KEYS) {
    const model = models[baseKey]
    if (model) claimedFieldsByModel[baseKey] = claimedIndexFields(model.indexes ?? [])
  }

  const scalarFields: Record<string, Record<string, FieldConfig>> = {}
  const foreignKeyFields: Record<string, Record<string, RelationshipField>> = {}
  const reverseRelationFields: Record<string, Record<string, RelationshipField>> = {}

  for (const modelKey of Object.keys(tables)) {
    const upstreamFields = tables[modelKey].fields
    // Base models always carry `db.timestamps: true` below regardless of
    // this check; a plugin table only skips createdAt/updatedAt here when it
    // declares both (so db.timestamps: true, set further down, can stand in
    // for them) — otherwise they fall through and derive as ordinary scalar
    // columns instead of being silently dropped.
    const skipTimestampFields =
      (BASE_MODEL_KEYS as readonly string[]).includes(modelKey) ||
      hasSymmetricTimestamps(upstreamFields)
    for (const [fieldKey, upstream] of Object.entries(upstreamFields)) {
      if (TIMESTAMP_FIELDS.has(fieldKey) && skipTimestampFields) continue

      if (upstream.references) {
        const targetModelKey = upstream.references.model
        const targetListKey = registry.get(targetModelKey)
        if (!targetListKey) {
          throw new Error(
            `deriveAuthLists: "${modelKey}.${fieldKey}" references unknown model "${targetModelKey}"`,
          )
        }

        if (upstream.references.field === 'id') {
          const relationFieldKey = relationshipFieldName(fieldKey)
          const reverseName = reverseRelationName(modelKey)
          if (reverseRelationFields[targetModelKey]?.[reverseName]) {
            // The reverse name is derived from the *model* (pluralized), not
            // the field — two id-referencing FKs on the same model targeting
            // the same model would collapse onto one reverse field and
            // silently produce an ambiguous/incorrect relation. Fail loudly;
            // resolve via `REVERSE_RELATION_NAME_OVERRIDES`.
            throw new Error(
              `deriveAuthLists: "${modelKey}" has more than one reference to "${targetModelKey}" ` +
                `resolving to the same reverse relation name "${reverseName}" — add an override to ` +
                `REVERSE_RELATION_NAME_OVERRIDES in derive-auth-lists.ts`,
            )
          }
          ;(foreignKeyFields[modelKey] ??= {})[relationFieldKey] = buildForeignKeyField(
            fieldKey,
            upstream,
            targetListKey,
            reverseName,
            claimedFieldsByModel[modelKey as BaseModelKey]?.has(relationFieldKey) ?? false,
          )
          ;(reverseRelationFields[targetModelKey] ??= {})[reverseName] = relationship({
            ref: `${registry.get(modelKey)}.${relationFieldKey}`,
            many: true,
          })
        } else {
          // relationship() always references the target's `id` column —
          // better-auth's own oidc-provider schema (the MCP plugin's OAuth
          // tables) references oauthApplication.clientId instead, which a
          // relation can't express without pointing Prisma at the wrong
          // column. Left as a plain scalar column, same as pre-consolidation
          // behavior (issue #992).
          ;(scalarFields[modelKey] ??= {})[fieldKey] = withCredentialAccess(
            credentialRegistry,
            modelKey,
            fieldKey,
            buildScalarField(
              fieldKey,
              upstream,
              claimedFieldsByModel[modelKey as BaseModelKey]?.has(fieldKey) ?? false,
            ),
          )
        }
      } else {
        ;(scalarFields[modelKey] ??= {})[fieldKey] = withCredentialAccess(
          credentialRegistry,
          modelKey,
          fieldKey,
          buildScalarField(
            fieldKey,
            upstream,
            claimedFieldsByModel[modelKey as BaseModelKey]?.has(fieldKey) ?? false,
          ),
        )
      }
    }
  }

  /**
   * `FIELD_ORDER` only pins the position of fields it names — it is never
   * the source of truth for *which* fields exist. Every key derived from
   * `tables[modelKey].fields` above (scalar or foreign-key) is emitted here
   * regardless of whether `FIELD_ORDER` lists it, appended after the pinned
   * ones in the order `getAuthTables` returned them, so a field a future
   * better-auth release adds — the exact drift class this derivation exists
   * to close (#986) — still reaches the generated schema; it just lands at
   * the end of the model until `FIELD_ORDER` is updated to place it. A
   * plugin table has no `FIELD_ORDER` entry at all, so every one of its
   * fields lands in upstream order.
   */
  function assembleFields(modelKey: string): Record<string, FieldConfig> {
    const fields: Record<string, FieldConfig> = {}
    const remaining = new Map([
      ...Object.entries(scalarFields[modelKey] ?? {}),
      ...Object.entries(foreignKeyFields[modelKey] ?? {}),
    ])

    for (const fieldKey of FIELD_ORDER[modelKey as BaseModelKey] ?? []) {
      const field = remaining.get(fieldKey)
      if (field) {
        fields[fieldKey] = field
        remaining.delete(fieldKey)
      }
    }
    for (const [fieldKey, field] of remaining) {
      fields[fieldKey] = field
    }

    Object.assign(fields, reverseRelationFields[modelKey])
    return fields
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  const lists: Record<string, ListConfig<any>> = {
    [keys.user]: list({
      fields: { ...assembleFields('user'), ...(userConfig.fields || {}) },
      db: listDb(models.user, true),
      access: userConfig.access || accessConfig.user,
      hooks: userConfig.hooks,
    }),
    [keys.session]: list({
      fields: assembleFields('session'),
      db: listDb(models.session, true),
      access: accessConfig.session,
    }),
    [keys.account]: list({
      fields: assembleFields('account'),
      db: listDb(models.account, true),
      access: accessConfig.account,
    }),
    [keys.verification]: list({
      fields: assembleFields('verification'),
      db: listDb(models.verification, true),
      access: accessConfig.verification,
    }),
  }

  if (models.rateLimit && keys.rateLimit) {
    lists[keys.rateLimit] = list({
      fields: assembleFields('rateLimit'),
      db: listDb(models.rateLimit, false),
      access: accessConfig.rateLimit,
    })
  }

  const baseKeysPresent = new Set<string>(['user', 'session', 'account', 'verification'])
  if (models.rateLimit) baseKeysPresent.add('rateLimit')

  for (const modelKey of Object.keys(tables)) {
    if (baseKeysPresent.has(modelKey)) continue

    const listKey = registry.get(modelKey)
    if (!listKey) continue // unreachable: buildModelRegistry registers every table key

    const physicalName = tables[modelKey].modelName
    const timestamps = hasSymmetricTimestamps(tables[modelKey].fields)
    const mapNeeded = listKey !== physicalName
    lists[listKey] = list({
      fields: assembleFields(modelKey),
      ...(timestamps || mapNeeded
        ? {
            db: {
              ...(timestamps ? { timestamps: true as const } : {}),
              ...(mapNeeded ? { map: physicalName } : {}),
            },
          }
        : {}),
    })
  }

  return { keys, lists }
}
