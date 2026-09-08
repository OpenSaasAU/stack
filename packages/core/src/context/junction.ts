import type { FieldConfig, OpenSaasConfig, RelationshipField } from '../config/types.js'
import { isRelationshipField, shouldHaveForeignKey } from '../fields/index.js'

/**
 * The two ends of one edge across an explicit junction list, resolved from the
 * parent list's to-many field.
 *
 * An edge is a row of {@link junctionListKey}: {@link backReferenceField} holds
 * the foreign key to the parent, {@link targetField} the foreign key to the far
 * endpoint. Adding one is therefore a create of that row under the junction
 * list's own create access, never a nested write on the parent (ADR-0050,
 * ADR-0018 as amended).
 */
export interface JunctionEdge {
  /** The list an edge row belongs to. */
  junctionListKey: string
  /** The junction field whose foreign key names the parent record. */
  backReferenceField: string
  /** The junction field whose foreign key names the far endpoint. */
  targetField: string
  /** The list the far endpoint belongs to. */
  targetListKey: string
}

/** Added by the generator rather than declared, so never data the row carries. */
const SYSTEM_FIELDS = new Set(['id', 'createdAt', 'updatedAt'])

/**
 * Whether a non-relationship field of a candidate junction list carries data of
 * its own.
 *
 * This is the whole difference between an edge and an ordinary child row, and
 * structure is the only evidence available: `PostTag { post, tag }` is fully
 * determined by its two endpoints, while `Comment { body, post, author }` is a
 * row with a column two ids cannot fill. Requiredness cannot make the call —
 * `body` is nullable in both the application layer and the database, and
 * linking one would still write a blank comment.
 *
 * A virtual field is computed rather than stored, so it holds nothing.
 */
function carriesOwnData(fieldKey: string, field: FieldConfig): boolean {
  if (SYSTEM_FIELDS.has(fieldKey)) return false
  if (field.type === 'virtual') return false
  return !('virtual' in field && field.virtual === true)
}

/**
 * `config.lists` and a list's `fields` are plain object literals, so a key
 * naming an inherited member (`constructor`, `toString`) reads back as a
 * function rather than `undefined` and passes a truthiness guard. This resolver
 * runs inside a server action whose contract is to return a result rather than
 * throw, so every lookup here goes through an own-property check.
 */
function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

/**
 * Resolve `parentListKey.fieldName` as an edge across an explicit junction
 * list, or `null` when it is not one.
 *
 * It is one when the field is `many: true` with a bidirectional `ref`, the
 * named back-reference on the related list owns the foreign key to the parent,
 * exactly one other relationship field of that list owns a foreign key — the
 * far endpoint — and the list carries no stored field of its own beyond those
 * two links. `null` covers everything else, where adding a related row is an
 * update or a create of that row against its own list rather than an edge.
 *
 * Known limits — each yields `null`, so a caller falls back to the ordinary
 * to-many treatment rather than getting a wrong answer:
 * - a list-only `ref` (`ref: 'PostTag'`), which names no back-reference to
 *   preset the parent link through;
 * - a junction carrying a third foreign key, or none — the far endpoint is
 *   then not uniquely determined;
 * - a junction carrying any stored field of its own, whether or not anything
 *   requires it. Two ids cannot fill a column the caller was never asked
 *   about, and no requiredness flag separates an edge with an optional
 *   annotation from an ordinary two-parent child row (`Comment { body, post,
 *   author }`), which must keep its ordinary treatment.
 */
export function resolveJunctionEdge(
  config: OpenSaasConfig,
  parentListKey: string,
  fieldName: string,
): JunctionEdge | null {
  const parentList = own(config.lists, parentListKey)
  const field = parentList ? own(parentList.fields, fieldName) : undefined
  if (!isRelationshipField(field) || field.many !== true) return null

  const [junctionListKey, backReferenceField] = field.ref.split('.')
  if (!backReferenceField) return null

  const junctionList = own(config.lists, junctionListKey)
  if (!junctionList) return null

  const backReference = own(junctionList.fields, backReferenceField)
  if (!isRelationshipField(backReference)) return null
  if (!ownsForeignKey(config, junctionListKey, backReferenceField, backReference)) return null

  let target: { field: string; list: string } | null = null
  for (const [key, candidate] of Object.entries(junctionList.fields)) {
    if (key === backReferenceField) continue
    if (isRelationshipField(candidate)) {
      if (!ownsForeignKey(config, junctionListKey, key, candidate)) continue
      // A third foreign key leaves the far endpoint ambiguous, and picking one
      // would silently drop the other from the created row.
      if (target !== null) return null
      target = { field: key, list: candidate.ref.split('.')[0] }
      continue
    }
    if (carriesOwnData(key, candidate)) return null
  }

  if (target === null || !own(config.lists, target.list)) return null

  return {
    junctionListKey,
    backReferenceField,
    targetField: target.field,
    targetListKey: target.list,
  }
}

/**
 * `shouldHaveForeignKey` throws on a config `generate` would have refused — a
 * ref naming a list or field that is not declared, or a one-to-one claiming
 * `db.foreignKey` on both ends. This resolver runs while rendering an item view
 * and while handling a server action, so an unvalidated config must not fail
 * either: an ownership question with no answer is treated as "not this end",
 * which at worst leaves the field with its ordinary to-many treatment.
 */
function ownsForeignKey(
  config: OpenSaasConfig,
  listKey: string,
  fieldName: string,
  field: RelationshipField,
): boolean {
  if (!own(config.lists, field.ref.split('.')[0])) return false
  try {
    return shouldHaveForeignKey(listKey, fieldName, field, config)
  } catch {
    return false
  }
}
