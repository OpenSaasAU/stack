/**
 * `better-auth config → Auth lists` derivation, free of side effects and
 * plugin/runtime concerns. Reads better-auth's own resolved table
 * definitions (`getAuthTables`, re-exported from `better-auth/db`) rather
 * than hand-transcribing them, so the Auth lists cannot silently drift from
 * what better-auth itself declares (issue #987). See `packages/auth/CLAUDE.md`
 * ("Deriving Auth lists from better-auth config") for the full behavior and
 * examples.
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
import type { BetterAuthOptions } from 'better-auth'
import type { DBFieldAttribute } from 'better-auth/db'
import type { ListConfig, FieldConfig } from '@opensaas/stack-core'
import type { RelationshipField } from '@opensaas/stack-core/fields'
import type { ExtendUserListConfig } from '../lists/index.js'
import type { AuthAccessConfig, NormalizedAuthModelConfig, NormalizedAuthModels } from './types.js'

/**
 * The derived Auth list set together with the keys each list was placed under.
 * Keys are surfaced separately so callers (plugin add-vs-extend logic, runtime
 * user-key resolution) don't have to re-derive them.
 */
export type DerivedAuthLists = {
  /** Derived list keys, one per better-auth model. */
  keys: {
    user: string
    session: string
    account: string
    verification: string
    /** Only present when a `RateLimit` list was derived (`rateLimit.storage === 'database'`). */
    rateLimit?: string
  }
  /** The derived list configs, keyed by their derived list keys. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  lists: Record<string, ListConfig<any>>
}

/** better-auth's own fixed model keys — independent of the stack's list-key overrides (`modelName`). */
type ModelKey = 'user' | 'session' | 'account' | 'verification' | 'rateLimit'

const CORE_MODEL_ORDER: ModelKey[] = ['user', 'session', 'account', 'verification']

/**
 * Declared field order for each derived list, independent of the order
 * `getAuthTables` happens to return fields in. Prisma doesn't care about
 * field order, but pinning it keeps the generated schema stable across this
 * change (and future better-auth releases) instead of reshuffling on every
 * regenerate — the reverse relations (`user.sessions`/`user.accounts`) are
 * appended after these, in the order their owning model is processed below.
 */
const FIELD_ORDER: Record<ModelKey, string[]> = {
  user: ['name', 'email', 'emailVerified', 'image'],
  session: ['token', 'expiresAt', 'ipAddress', 'userAgent', 'user'],
  account: [
    'accountId',
    'providerId',
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
 * The reverse relation field name a foreign key implies on its target model
 * (e.g. `User.sessions`) has no source in better-auth's metadata at all —
 * `references` declares only the child→parent link, never a name for the
 * parent's reverse collection. Derived by pluralizing the child model's own
 * key, which reproduces every current name; override here for a collision or
 * a bad pluralization, one entry per better-auth model key.
 */
const REVERSE_RELATION_NAME_OVERRIDES: Partial<Record<ModelKey, string>> = {}

function pluralize(word: string): string {
  if (/[sxz]$|[cs]h$/.test(word)) return `${word}es`
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`
  return `${word}s`
}

function reverseRelationName(modelKey: ModelKey): string {
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

function scalarIsIndexed(upstream: DBFieldAttribute): true | 'unique' | undefined {
  if (upstream.unique) return 'unique'
  if (upstream.index) return true
  return undefined
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

function buildScalarField(fieldKey: string, upstream: DBFieldAttribute): FieldConfig {
  const isRequired = upstream.required ?? true
  const isIndexed = scalarIsIndexed(upstream)
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
        ...(staticDefault !== undefined ? { defaultValue: staticDefault as boolean } : {}),
        db,
      })
    }
    case 'date':
      return timestamp({ db })
    case 'number':
      return upstream.bigint
        ? bigInt({ ...(isRequired ? { validation: { isRequired: true as const } } : {}), db })
        : integer({ ...(isRequired ? { validation: { isRequired: true as const } } : {}), db })
    default:
      throw new Error(
        `deriveAuthLists: unsupported better-auth field type "${upstream.type}" for field "${fieldKey}"`,
      )
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
 */
function buildForeignKeyField(
  fieldKey: string,
  upstream: DBFieldAttribute,
  targetListKey: string,
  reverseFieldName: string,
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
  const isIndexed = scalarIsIndexed(upstream)

  return relationship({
    ref: `${targetListKey}.${reverseFieldName}`,
    ...(isIndexed ? { isIndexed } : {}),
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
 * Build the list-level `db` config (`timestamps` + `@@map` + `@@schema`) for a
 * derived list.
 *
 * `timestamps` is a per-model input, not hardcoded: better-auth's adapter
 * writes `createdAt`/`updatedAt` on every user/session/account/verification
 * row, so those four opt back into auto-timestamps now that they're OFF by
 * default (ADR-0004). The `RateLimit` model has neither column upstream, so
 * it passes `false`.
 */
function listDb(
  model: NormalizedAuthModelConfig,
  timestamps: boolean,
): { timestamps?: true; map?: string; schema?: string } {
  const schema = model.schema
  return {
    ...(timestamps ? { timestamps: true as const } : {}),
    ...(model.tableName !== undefined ? { map: model.tableName } : {}),
    ...(schema !== undefined ? { schema } : {}),
  }
}

function betterAuthModelOptions(model: NormalizedAuthModelConfig): {
  fields: Record<string, string>
} {
  return { fields: model.fields }
}

/** The options object fed to `getAuthTables` — carries only the per-model column overrides the app configured. */
function buildBetterAuthTableOptions(models: NormalizedAuthModels): BetterAuthOptions {
  return {
    user: betterAuthModelOptions(models.user),
    session: betterAuthModelOptions(models.session),
    account: betterAuthModelOptions(models.account),
    verification: betterAuthModelOptions(models.verification),
    ...(models.rateLimit
      ? { rateLimit: { storage: 'database' as const, ...betterAuthModelOptions(models.rateLimit) } }
      : {}),
  }
}

function emptyByModel<T>(): Record<ModelKey, Record<string, T>> {
  return { user: {}, session: {}, account: {}, verification: {}, rateLimit: {} }
}

/**
 * Derive the OpenSaaS Auth lists from the resolved better-auth model config.
 *
 * Per ADR-0013 the derived lists ship **closed** (no permissive operation
 * access) unless the application supplies access via `accessConfig` (the
 * `authPlugin({ access: … })` passthrough, keyed by better-auth model name) or,
 * for the user list specifically, `userConfig.access` (`extendUserList.access`,
 * which takes precedence — see {@link AuthAccessConfig}).
 *
 * A fifth `RateLimit` list is included only when `models.rateLimit` is
 * present (i.e. `rateLimit.storage === 'database'`).
 *
 * @param models - Resolved better-auth per-model config (modelName + field column maps)
 * @param userConfig - Extra User-list fields/access/hooks supplied via `extendUserList`
 * @param accessConfig - App-authored access for each Auth list, keyed by better-auth model name
 * @returns The derived list keys and the Auth list configs keyed by those keys
 */
export function deriveAuthLists(
  models: NormalizedAuthModels,
  userConfig: ExtendUserListConfig = {},
  accessConfig: AuthAccessConfig = {},
): DerivedAuthLists {
  const keys: DerivedAuthLists['keys'] = {
    user: models.user.modelName,
    session: models.session.modelName,
    account: models.account.modelName,
    verification: models.verification.modelName,
    ...(models.rateLimit ? { rateLimit: models.rateLimit.modelName } : {}),
  }

  const modelOrder: ModelKey[] = models.rateLimit
    ? [...CORE_MODEL_ORDER, 'rateLimit']
    : CORE_MODEL_ORDER
  const tables = getAuthTables(buildBetterAuthTableOptions(models))

  const scalarFields = emptyByModel<FieldConfig>()
  const foreignKeyFields = emptyByModel<RelationshipField>()
  const reverseRelationFields = emptyByModel<RelationshipField>()

  for (const modelKey of modelOrder) {
    const upstreamFields = tables[modelKey]?.fields ?? {}
    for (const [fieldKey, upstream] of Object.entries(upstreamFields)) {
      if (TIMESTAMP_FIELDS.has(fieldKey)) continue

      if (upstream.references) {
        const targetModelKey = upstream.references.model as ModelKey
        const targetListKey = keys[targetModelKey]
        if (!targetListKey) {
          throw new Error(
            `deriveAuthLists: "${modelKey}.${fieldKey}" references unknown model "${upstream.references.model}"`,
          )
        }

        const relationFieldKey = relationshipFieldName(fieldKey)
        const reverseName = reverseRelationName(modelKey)
        foreignKeyFields[modelKey][relationFieldKey] = buildForeignKeyField(
          fieldKey,
          upstream,
          targetListKey,
          reverseName,
        )
        reverseRelationFields[targetModelKey][reverseName] = relationship({
          ref: `${keys[modelKey]}.${relationFieldKey}`,
          many: true,
        })
      } else {
        scalarFields[modelKey][fieldKey] = buildScalarField(fieldKey, upstream)
      }
    }
  }

  function assembleFields(modelKey: ModelKey): Record<string, FieldConfig> {
    const fields: Record<string, FieldConfig> = {}
    for (const fieldKey of FIELD_ORDER[modelKey]) {
      const field = foreignKeyFields[modelKey][fieldKey] ?? scalarFields[modelKey][fieldKey]
      if (field) fields[fieldKey] = field
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

  return { keys, lists }
}
