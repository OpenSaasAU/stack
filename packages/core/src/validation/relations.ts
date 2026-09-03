import type {
  FieldConfig,
  ListConfig,
  OpenSaasConfig,
  RelationshipField,
  TypeInfo,
} from '../config/types.js'
import type { ConfigRefusal } from './config-refusal.js'

function isRelationshipField(field: FieldConfig | undefined): field is RelationshipField {
  return field?.type === 'relationship'
}

type RelationshipEnd = {
  listKey: string
  fieldKey: string
  field: RelationshipField
}

/**
 * The other end of a bidirectional `ref` (`'List.field'`), or `undefined` for
 * a list-only ref, an unknown target, or a target that is not a relationship
 * field — the last two are reported by relationship resolution elsewhere, not
 * here.
 */
function resolveOtherEnd(
  config: OpenSaasConfig,
  field: RelationshipField,
): RelationshipEnd | undefined {
  const [listKey, fieldKey] = field.ref.split('.')
  if (!listKey || !fieldKey) return undefined
  const target = config.lists[listKey]?.fields[fieldKey]
  if (!isRelationshipField(target)) return undefined
  return { listKey, fieldKey, field: target }
}

function endKey(end: RelationshipEnd): string {
  return `${end.listKey}.${end.fieldKey}`
}

/**
 * Whether `a` sorts before `b`, so a pairwise refusal is reported once, from
 * the end that sorts first. Equal keys (a self-referential field) report.
 */
function reportsForPair(a: RelationshipEnd, b: RelationshipEnd): boolean {
  return endKey(a).localeCompare(endKey(b)) <= 0
}

function isOneToOne(a: RelationshipEnd, b: RelationshipEnd): boolean {
  return !a.field.many && !b.field.many
}

/**
 * Which end of a one-to-one owns the foreign key column (ADR-0064): the end
 * that sets `db.foreignKey: true`, else the alphabetically smaller list name,
 * else — self-referential — the alphabetically smaller field name. Returns
 * `undefined` when both ends claim it, which is its own refusal.
 */
function resolveOneToOneOwner(a: RelationshipEnd, b: RelationshipEnd): RelationshipEnd | undefined {
  const aClaims = a.field.db?.foreignKey === true
  const bClaims = b.field.db?.foreignKey === true
  if (aClaims && bClaims) return undefined
  if (aClaims) return a
  if (bClaims) return b
  const byList = a.listKey.localeCompare(b.listKey)
  if (byList !== 0) return byList < 0 ? a : b
  return a.fieldKey.localeCompare(b.fieldKey) < 0 ? a : b
}

/**
 * The spelling a composite primary key would take on `db.idField`. Composite
 * keys are out of scope (ADR-0048); a relationship at a list carrying one is
 * refused in advance rather than growing a multi-column foreign key.
 */
function isCompositeKeyed(listConfig: ListConfig<TypeInfo> | undefined): boolean {
  const idField: unknown = listConfig?.db?.idField
  return (
    typeof idField === 'object' &&
    idField !== null &&
    'fields' in idField &&
    Array.isArray(idField.fields)
  )
}

function fixOwnership(nonOwner: RelationshipEnd, owner: RelationshipEnd): string {
  return (
    `Set it on "${endKey(owner)}" instead, or make "${endKey(nonOwner)}" own the foreign key ` +
    `with db.foreignKey: true.`
  )
}

function refuseRelationshipField(config: OpenSaasConfig, end: RelationshipEnd): ConfigRefusal[] {
  const refusals: ConfigRefusal[] = []
  const entry = `fields.${end.fieldKey}`
  const [targetListKey] = end.field.ref.split('.')

  if (targetListKey && isCompositeKeyed(config.lists[targetListKey])) {
    refusals.push({
      listKey: end.listKey,
      entry,
      reason: 'composite-keyed-target',
      message:
        `List "${end.listKey}": ${entry} points at list "${targetListKey}", whose db.idField declares a ` +
        `composite primary key. A relationship cannot target a composite-keyed list — composite primary keys ` +
        `are out of scope (ADR-0048); give "${targetListKey}" a single-column id.`,
    })
  }

  const other = resolveOtherEnd(config, end.field)
  if (!other) return refusals

  if (end.field.many && other.field.many) {
    if (reportsForPair(end, other)) {
      refusals.push({
        listKey: end.listKey,
        entry,
        reason: 'many-to-many',
        message:
          `List "${end.listKey}": ${entry} and list "${other.listKey}": fields.${other.fieldKey} are both ` +
          `many: true — an implicit many-to-many, which the contract cannot carry (ADR-0048). Author the ` +
          `junction as its own list with a to-one relationship to each side, a surrogate id and a unique ` +
          `db.indexes entry over those two fields, then point "${end.listKey}.${end.fieldKey}" and ` +
          `"${other.listKey}.${other.fieldKey}" at the junction with many: true.`,
      })
    }
    return refusals
  }

  if (!isOneToOne(end, other)) return refusals

  const owner = resolveOneToOneOwner(end, other)
  if (!owner) {
    if (reportsForPair(end, other)) {
      refusals.push({
        listKey: end.listKey,
        entry,
        reason: 'foreign-key-on-both-sides',
        message:
          `List "${end.listKey}": ${entry} and list "${other.listKey}": fields.${other.fieldKey} both set ` +
          `db.foreignKey: true on a one-to-one relationship, but only one side can own the foreign key ` +
          `column. Remove db.foreignKey from one of them.`,
      })
    }
    return refusals
  }

  if (owner === end) return refusals

  if (end.field.db?.isNullable === false) {
    refusals.push({
      listKey: end.listKey,
      entry,
      reason: 'non-owning-side-nullability',
      message:
        `List "${end.listKey}": ${entry} sets db.isNullable: false, but it is the non-owning side of the ` +
        `one-to-one with "${endKey(other)}" and has no column of its own to make non-nullable. ` +
        fixOwnership(end, other),
    })
  }

  return refusals
}

function refuseNonOwningSideIndexes(
  config: OpenSaasConfig,
  listKey: string,
  listConfig: ListConfig<TypeInfo>,
): ConfigRefusal[] {
  const refusals: ConfigRefusal[] = []
  const indexes = listConfig.db?.indexes ?? []

  indexes.forEach((index, i) => {
    for (const fieldRef of index.fields) {
      const fieldKey = typeof fieldRef === 'string' ? fieldRef : fieldRef.field
      const field = listConfig.fields[fieldKey]
      if (!isRelationshipField(field) || field.many) continue

      const end: RelationshipEnd = { listKey, fieldKey, field }
      const other = resolveOtherEnd(config, field)
      if (!other || !isOneToOne(end, other)) continue

      const owner = resolveOneToOneOwner(end, other)
      if (!owner || owner === end) continue

      refusals.push({
        listKey,
        entry: `db.indexes[${i}]`,
        reason: 'non-owning-side-index',
        message:
          `List "${listKey}": db.indexes[${i}] names field "${fieldKey}", the non-owning side of the ` +
          `one-to-one with "${endKey(other)}" — there is no column on this side to index. ` +
          `Index "${other.fieldKey}" from list "${other.listKey}"'s db.indexes instead, or make ` +
          `"${endKey(end)}" own the foreign key with db.foreignKey: true.`,
      })
    }
  })

  return refusals
}

/**
 * Refuse the relationship shapes the Prisma 8 contract cannot carry, each
 * naming the list, the entry and the fix: `many: true` on both ends
 * (ADR-0048), `db.foreignKey: true` on both ends of a one-to-one,
 * `db.isNullable: false` or a `db.indexes` entry on a one-to-one's non-owning
 * end (ADR-0064), and a relationship at a composite-keyed list (ADR-0048).
 * A pairwise refusal is reported once, from the end whose `List.field` key
 * sorts first.
 */
export function validateRelations(config: OpenSaasConfig): ConfigRefusal[] {
  const refusals: ConfigRefusal[] = []

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    for (const [fieldKey, field] of Object.entries(listConfig.fields)) {
      if (!isRelationshipField(field)) continue
      refusals.push(...refuseRelationshipField(config, { listKey, fieldKey, field }))
    }
    refusals.push(...refuseNonOwningSideIndexes(config, listKey, listConfig))
  }

  return refusals
}
