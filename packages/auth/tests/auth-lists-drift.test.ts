import { describe, it, expect } from 'vitest'
import { getAuthTables } from 'better-auth/db'
import type { BetterAuthOptions } from 'better-auth'
import type { DBFieldAttribute } from 'better-auth/db'
import type { FieldConfig } from '@opensaas/stack-core'
import type { RelationshipField } from '@opensaas/stack-core/fields'
import { deriveAuthLists } from '../src/config/derive-auth-lists.js'
import type { NormalizedAuthModels } from '../src/config/types.js'

/**
 * Drift detector for issue #988: reads better-auth's own resolved table
 * definitions (`getAuthTables`) and compares them against `deriveAuthLists`'
 * output — column name, index presence, uniqueness, field presence,
 * requiredness, references, scalar type, and static default values — so an
 * upstream schema change that the hand-written derivation doesn't mirror
 * fails this suite instead of waiting for a human to notice (as
 * #921/#935/#937/#981/#986 all were).
 *
 * Deliberately out of scope (see the issue body): fields the stack adds that
 * better-auth doesn't declare (timestamps, access blocks, extendUserList
 * merging), constraint *names* (#921), and `returned: false` (a serialization
 * contract, not a schema fact).
 */

type Divergence = {
  model: string
  field: string
  dimension: string
  detail: string
}

/**
 * better-auth models its foreign keys as a plain scalar field carrying
 * `references`; the derived lists model the same column as a `relationship()`
 * field under a different key. This is the map between the two per model.
 */
const FK_BRIDGE: Record<string, Record<string, string>> = {
  session: { userId: 'user' },
  account: { userId: 'user' },
}

/** better-auth writes these on every row; the derived lists opt in via list-level `db.timestamps` rather than a per-field entry. */
const TIMESTAMP_FIELDS = new Set(['createdAt', 'updatedAt'])

function normalizeOnDelete(action: string): string {
  return action.replace(/\s+/g, '').toLowerCase()
}

/**
 * The Prisma scalar type a correctly-derived field should carry for a given
 * better-auth field type. `undefined` means "not modeled by any field in
 * these lists" (json/array types don't appear on user/session/account/
 * verification/rateLimit) — the caller skips the comparison in that case
 * rather than treating it as a mismatch.
 */
function expectedPrismaType(upstream: DBFieldAttribute): string | undefined {
  switch (upstream.type) {
    case 'string':
      return 'String'
    case 'boolean':
      return 'Boolean'
    case 'date':
      return 'DateTime'
    case 'number':
      return upstream.bigint ? 'BigInt' : 'Int'
    default:
      return undefined
  }
}

/** Narrows a derived list's field to a `RelationshipField` — the shape the FK-bridged comparison reads. */
function isRelationshipField(field: FieldConfig): field is RelationshipField {
  return field.type === 'relationship'
}

function compareScalarField(
  model: string,
  fieldKey: string,
  upstream: DBFieldAttribute,
  derived: FieldConfig | undefined,
  divergences: Divergence[],
): void {
  if (!derived || !derived.getPrismaType) {
    divergences.push({
      model,
      field: fieldKey,
      dimension: 'field presence',
      detail: `better-auth declares '${fieldKey}' but the derived list has no matching field`,
    })
    return
  }

  const prismaType = derived.getPrismaType(fieldKey)
  const isNullable = prismaType.modifiers?.startsWith('?') ?? false
  const isUnique = prismaType.modifiers?.includes('@unique') ?? false
  const isIndexed = prismaType.index === true

  const derivedColumn = derived.db?.map ?? fieldKey
  if (derivedColumn !== upstream.fieldName) {
    divergences.push({
      model,
      field: fieldKey,
      dimension: 'column name',
      detail: `better-auth column "${upstream.fieldName}" vs derived map "${derivedColumn}"`,
    })
  }

  const upstreamRequired = upstream.required ?? true
  if (isNullable === upstreamRequired) {
    divergences.push({
      model,
      field: fieldKey,
      dimension: 'requiredness',
      detail: `better-auth required=${upstreamRequired} vs derived nullable=${isNullable}`,
    })
  }

  const upstreamIndex = upstream.index === true
  if (isIndexed !== upstreamIndex) {
    divergences.push({
      model,
      field: fieldKey,
      dimension: 'index presence',
      detail: `better-auth index=${upstreamIndex} vs derived isIndexed=true is ${isIndexed}`,
    })
  }

  const upstreamUnique = upstream.unique === true
  if (isUnique !== upstreamUnique) {
    divergences.push({
      model,
      field: fieldKey,
      dimension: 'uniqueness',
      detail: `better-auth unique=${upstreamUnique} vs derived isIndexed='unique' is ${isUnique}`,
    })
  }

  const expectedType = expectedPrismaType(upstream)
  if (expectedType !== undefined && prismaType.type !== expectedType) {
    divergences.push({
      model,
      field: fieldKey,
      dimension: 'scalar type',
      detail: `better-auth type "${upstream.type}"${upstream.bigint ? ' (bigint)' : ''} expects Prisma "${expectedType}" vs derived "${prismaType.type}"`,
    })
  }

  // Only a static, non-function default is comparable — better-auth's
  // function-valued defaults (e.g. `createdAt: () => new Date()`) are applied
  // at write time, not modeled as a derived field's own `defaultValue`.
  if (typeof upstream.defaultValue !== 'function' && upstream.defaultValue !== undefined) {
    if (derived.defaultValue !== upstream.defaultValue) {
      divergences.push({
        model,
        field: fieldKey,
        dimension: 'default value',
        detail: `better-auth defaultValue=${JSON.stringify(upstream.defaultValue)} vs derived defaultValue=${JSON.stringify(derived.defaultValue)}`,
      })
    }
  }
}

function compareForeignKeyField(
  model: string,
  upstreamFieldKey: string,
  upstream: DBFieldAttribute,
  derived: RelationshipField | undefined,
  listKeys: Record<string, string>,
  divergences: Divergence[],
): void {
  if (!derived) {
    divergences.push({
      model,
      field: upstreamFieldKey,
      dimension: 'field presence',
      detail: `better-auth declares '${upstreamFieldKey}' but the derived relationship is missing`,
    })
    return
  }

  const foreignKey = derived.db?.foreignKey
  const derivedColumn = typeof foreignKey === 'object' ? foreignKey.map : undefined
  if (derivedColumn !== upstream.fieldName) {
    divergences.push({
      model,
      field: upstreamFieldKey,
      dimension: 'column name',
      detail: `better-auth column "${upstream.fieldName}" vs derived FK map "${derivedColumn}"`,
    })
  }

  const isIndexed = derived.isIndexed === true
  const upstreamIndex = upstream.index === true
  if (isIndexed !== upstreamIndex) {
    divergences.push({
      model,
      field: upstreamFieldKey,
      dimension: 'index presence',
      detail: `better-auth index=${upstreamIndex} vs derived isIndexed=true is ${isIndexed}`,
    })
  }

  const isUnique = derived.isIndexed === 'unique'
  const upstreamUnique = upstream.unique === true
  if (isUnique !== upstreamUnique) {
    divergences.push({
      model,
      field: upstreamFieldKey,
      dimension: 'uniqueness',
      detail: `better-auth unique=${upstreamUnique} vs derived isIndexed='unique' is ${isUnique}`,
    })
  }

  const isNullable = derived.db?.isNullable ?? true
  const derivedRequired = !isNullable
  const upstreamRequired = upstream.required ?? true
  if (derivedRequired !== upstreamRequired) {
    divergences.push({
      model,
      field: upstreamFieldKey,
      dimension: 'requiredness',
      detail: `better-auth required=${upstreamRequired} vs derived required=${derivedRequired}`,
    })
  }

  const references = upstream.references
  if (references) {
    const [targetListKey] = derived.ref.split('.')
    const expectedListKey = listKeys[references.model]
    if (targetListKey !== expectedListKey) {
      divergences.push({
        model,
        field: upstreamFieldKey,
        dimension: 'references',
        detail: `better-auth references model "${references.model}" (list "${expectedListKey}") vs derived ref targets "${targetListKey}"`,
      })
    }

    const extend = derived.db?.extendPrismaSchema
    const relationLine = extend
      ? extend({ relationLine: '@relation(fields: [x], references: [id])' }).relationLine
      : ''
    const derivedOnDelete = /onDelete:\s*(\w+)/.exec(relationLine)?.[1] ?? ''
    const upstreamOnDelete = references.onDelete ?? 'cascade'
    if (normalizeOnDelete(derivedOnDelete) !== normalizeOnDelete(upstreamOnDelete)) {
      divergences.push({
        model,
        field: upstreamFieldKey,
        dimension: 'references',
        detail: `better-auth onDelete="${upstreamOnDelete}" vs derived relation line "${relationLine}"`,
      })
    }
  }
}

function compareModel(
  model: string,
  upstreamFields: Record<string, DBFieldAttribute>,
  derivedFields: Record<string, FieldConfig>,
  listKeys: Record<string, string>,
  divergences: Divergence[],
): void {
  const bridges = FK_BRIDGE[model] ?? {}

  for (const [fieldKey, upstream] of Object.entries(upstreamFields)) {
    if (TIMESTAMP_FIELDS.has(fieldKey)) continue

    const bridgedKey = bridges[fieldKey]
    if (bridgedKey) {
      const candidate = derivedFields[bridgedKey]
      const relationshipField = candidate && isRelationshipField(candidate) ? candidate : undefined
      compareForeignKeyField(model, fieldKey, upstream, relationshipField, listKeys, divergences)
    } else {
      compareScalarField(model, fieldKey, upstream, derivedFields[fieldKey], divergences)
    }
  }
}

/**
 * Known, tracked divergences the comparison above would otherwise fail on.
 * Each entry must name the field, dimension, and issue tracking the fix.
 * When the fix lands, remove the entry — an entry that no longer matches a
 * real divergence fails `no stale exceptions` below, so this list can't rot
 * into a permanent silencer.
 */
const KNOWN_EXCEPTIONS: Divergence[] = []

function exceptionKey(d: Divergence): string {
  return `${d.model}.${d.field}:${d.dimension}`
}

describe('derived auth lists match better-auth’s own table definitions (issue #988)', () => {
  const defaultModels: NormalizedAuthModels = {
    user: { modelName: 'User', fields: {} },
    session: { modelName: 'Session', fields: {} },
    account: { modelName: 'Account', fields: {} },
    verification: { modelName: 'Verification', fields: {} },
  }

  const defaultOptions: BetterAuthOptions = {}
  const upstreamTables = getAuthTables(defaultOptions)
  const { keys, lists } = deriveAuthLists(defaultModels)

  const divergences: Divergence[] = []
  for (const model of ['user', 'session', 'account', 'verification'] as const) {
    const listKey = keys[model]
    compareModel(model, upstreamTables[model].fields, lists[listKey].fields, keys, divergences)
  }

  const unexpected = divergences.filter(
    (d) => !KNOWN_EXCEPTIONS.some((known) => exceptionKey(known) === exceptionKey(d)),
  )
  const staleExceptions = KNOWN_EXCEPTIONS.filter(
    (known) => !divergences.some((d) => exceptionKey(d) === exceptionKey(known)),
  )

  it('has no unexpected divergences from better-auth’s user/session/account/verification tables', () => {
    expect(unexpected, JSON.stringify(unexpected, null, 2)).toEqual([])
  })

  it('has no stale exception-list entries (fixed drift must be removed from KNOWN_EXCEPTIONS)', () => {
    expect(staleExceptions, JSON.stringify(staleExceptions, null, 2)).toEqual([])
  })

  it('detects a real regression: removing isIndexed from Session.user', () => {
    const mutated = deriveAuthLists(defaultModels)
    mutated.lists[mutated.keys.session].fields.user.isIndexed = false

    const regressionDivergences: Divergence[] = []
    compareModel(
      'session',
      upstreamTables.session.fields,
      mutated.lists[mutated.keys.session].fields,
      mutated.keys,
      regressionDivergences,
    )

    expect(regressionDivergences).toContainEqual(
      expect.objectContaining({ model: 'session', field: 'userId', dimension: 'index presence' }),
    )
  })

  it('detects a real regression: changing the userId FK column map', () => {
    const mutated = deriveAuthLists(defaultModels)
    mutated.lists[mutated.keys.account].fields.user.db.foreignKey = { map: 'wrong_column' }

    const regressionDivergences: Divergence[] = []
    compareModel(
      'account',
      upstreamTables.account.fields,
      mutated.lists[mutated.keys.account].fields,
      mutated.keys,
      regressionDivergences,
    )

    expect(regressionDivergences).toContainEqual(
      expect.objectContaining({ model: 'account', field: 'userId', dimension: 'column name' }),
    )
  })

  it('detects a real regression: a field upstream declares going missing from the derived list', () => {
    const mutated = deriveAuthLists(defaultModels)
    delete mutated.lists[mutated.keys.account].fields.scope

    const regressionDivergences: Divergence[] = []
    compareModel(
      'account',
      upstreamTables.account.fields,
      mutated.lists[mutated.keys.account].fields,
      mutated.keys,
      regressionDivergences,
    )

    expect(regressionDivergences).toContainEqual(
      expect.objectContaining({ model: 'account', field: 'scope', dimension: 'field presence' }),
    )
  })
})

describe('derived RateLimit list matches better-auth’s database-backed rateLimit table (issue #988)', () => {
  const models: NormalizedAuthModels = {
    user: { modelName: 'User', fields: {} },
    session: { modelName: 'Session', fields: {} },
    account: { modelName: 'Account', fields: {} },
    verification: { modelName: 'Verification', fields: {} },
    rateLimit: { modelName: 'RateLimit', fields: {} },
  }

  const rateLimitOptions: BetterAuthOptions = { rateLimit: { storage: 'database' } }
  const upstreamTables = getAuthTables(rateLimitOptions)
  const { keys, lists } = deriveAuthLists(models)

  it('is present upstream only when rateLimit.storage is "database"', () => {
    expect(upstreamTables.rateLimit).toBeDefined()
    expect(keys.rateLimit).toBe('RateLimit')
  })

  it('has no divergences on key/count/lastRequest', () => {
    const divergences: Divergence[] = []
    compareModel(
      'rateLimit',
      upstreamTables.rateLimit.fields,
      lists.RateLimit.fields,
      keys,
      divergences,
    )

    expect(divergences, JSON.stringify(divergences, null, 2)).toEqual([])
  })
})
