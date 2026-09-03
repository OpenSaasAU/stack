import type {
  FieldConfig,
  ListConfig,
  OpenSaasConfig,
  RelationshipField,
  TypeInfo,
} from '../config/types.js'
import { claimsForeignKey, isOneToOneRelationship, shouldHaveForeignKey } from '../fields/index.js'
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

function sameEnd(a: RelationshipEnd, b: RelationshipEnd): boolean {
  return endKey(a) === endKey(b)
}

/**
 * Whether `a` sorts before `b`, so a pairwise refusal is reported once, from
 * the end that sorts first. Equal keys (a self-referential field) report.
 */
function reportsForPair(a: RelationshipEnd, b: RelationshipEnd): boolean {
  return endKey(a).localeCompare(endKey(b)) <= 0
}

function isOneToOne(config: OpenSaasConfig, end: RelationshipEnd): boolean {
  return isOneToOneRelationship(end.fieldKey, end.field, config)
}

type Ownership = 'owner' | 'non-owner' | 'contested'

/**
 * Which side of a one-to-one `end` is, by the generator's own rule
 * (`shouldHaveForeignKey`). A field that refs itself is both ends and owns
 * the column; both ends claiming it is `contested`, its own refusal.
 */
function resolveOwnership(
  config: OpenSaasConfig,
  end: RelationshipEnd,
  other: RelationshipEnd,
): Ownership {
  if (sameEnd(end, other)) return 'owner'
  if (claimsForeignKey(end.field) && claimsForeignKey(other.field)) return 'contested'
  return shouldHaveForeignKey(end.listKey, end.fieldKey, end.field, config) ? 'owner' : 'non-owner'
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

function junctionFix(ends: RelationshipEnd[]): string {
  const pointers = ends.map((end) => `"${endKey(end)}"`).join(' and ')
  return (
    `Author the junction as its own list with a to-one relationship to each side, a surrogate id and ` +
    `a unique db.indexes entry over those two fields, then point ${pointers} at the junction with many: true.`
  )
}

function referentialActionKeys(field: RelationshipField): string[] {
  const keys: string[] = []
  if (field.db?.onDelete !== undefined) keys.push('db.onDelete')
  if (field.db?.onUpdate !== undefined) keys.push('db.onUpdate')
  return keys
}

function refuseNonOwningReferentialActions(
  end: RelationshipEnd,
  owner: RelationshipEnd,
  side: string,
  fix: string,
): ConfigRefusal[] {
  const keys = referentialActionKeys(end.field)
  if (keys.length === 0) return []
  const entry = `fields.${end.fieldKey}`
  return [
    {
      listKey: end.listKey,
      entry,
      reason: 'non-owning-side-referential-action',
      message:
        `List "${end.listKey}": ${entry} sets ${keys.join(' and ')}, but it is ${side} ` +
        `"${endKey(owner)}" and has no foreign key column for a referential action to act on. ${fix}`,
    },
  ]
}

function refuseSetNullOnRequired(end: RelationshipEnd): ConfigRefusal[] {
  if (end.field.db?.isNullable !== false) return []
  const keys: string[] = []
  if (end.field.db?.onDelete === 'setNull') keys.push('db.onDelete')
  if (end.field.db?.onUpdate === 'setNull') keys.push('db.onUpdate')
  if (keys.length === 0) return []
  const entry = `fields.${end.fieldKey}`
  return [
    {
      listKey: end.listKey,
      entry,
      reason: 'set-null-on-required-relation',
      message:
        `List "${end.listKey}": ${entry} sets ${keys.join(' and ')}: 'setNull' together with ` +
        `db.isNullable: false, but Prisma rejects SetNull on a required relation — a non-nullable column ` +
        `has nothing to set to null. Drop db.isNullable: false, or use another action such as 'cascade' ` +
        `or 'restrict'.`,
    },
  ]
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
  if (!other) {
    if (end.field.many) {
      refusals.push({
        listKey: end.listKey,
        entry,
        reason: 'many-to-many',
        message:
          `List "${end.listKey}": ${entry} is many: true with the list-only ref "${end.field.ref}" — an ` +
          `implicit many-to-many, which the contract cannot carry (ADR-0048). ${junctionFix([end])}`,
      })
      return refusals
    }
    refusals.push(...refuseSetNullOnRequired(end))
    return refusals
  }

  if (end.field.many && other.field.many) {
    if (reportsForPair(end, other)) {
      refusals.push({
        listKey: end.listKey,
        entry,
        reason: 'many-to-many',
        message:
          `List "${end.listKey}": ${entry} and list "${other.listKey}": fields.${other.fieldKey} are both ` +
          `many: true — an implicit many-to-many, which the contract cannot carry (ADR-0048). ` +
          junctionFix([end, other]),
      })
    }
    return refusals
  }

  if (end.field.many) {
    refusals.push(
      ...refuseNonOwningReferentialActions(
        end,
        other,
        'the to-many side of the one-to-many with',
        `Set it on "${endKey(other)}" instead.`,
      ),
    )
    return refusals
  }

  if (!isOneToOne(config, end)) {
    refusals.push(...refuseSetNullOnRequired(end))
    return refusals
  }

  const ownership = resolveOwnership(config, end, other)
  if (ownership === 'contested') {
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

  if (ownership === 'owner') {
    refusals.push(...refuseSetNullOnRequired(end))
    return refusals
  }

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

  refusals.push(
    ...refuseNonOwningReferentialActions(
      end,
      other,
      'the non-owning side of the one-to-one with',
      fixOwnership(end, other),
    ),
  )

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
      if (!other || !isOneToOne(config, end)) continue
      if (resolveOwnership(config, end, other) !== 'non-owner') continue

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
 * naming the list, the entry and the fix: `many: true` on both ends or on a
 * list-only ref (ADR-0048), `db.foreignKey: true` on both ends of a
 * one-to-one, `db.isNullable: false`, `db.onDelete`/`db.onUpdate` or a
 * `db.indexes` entry on a side that owns no foreign key column (ADR-0064),
 * `'setNull'` on a `db.isNullable: false` column, and a relationship at a
 * composite-keyed list (ADR-0048). Ownership is the generator's own rule
 * (`shouldHaveForeignKey`). A pairwise refusal is reported once, from the end
 * whose `List.field` key sorts first.
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
