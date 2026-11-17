import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import {
  resolveListMember,
  resolveListMembers,
  type DeclaredFieldStorage,
  type ListMember,
} from '../members/list-members.js'

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

/**
 * Whether a stored, non-relationship field of a candidate junction list
 * carries data of its own.
 *
 * This is the whole difference between an edge and an ordinary child row, and
 * structure is the only evidence available: `PostTag { post, tag }` is fully
 * determined by its two endpoints, while `Comment { body, post, author }` is a
 * row with a column two ids cannot fill. Requiredness cannot make the call —
 * `body` is nullable in both the application layer and the database, and
 * linking one would still write a blank comment.
 */
function carriesOwnData(fieldKey: string, field: FieldConfig): boolean {
  if (fieldKey === 'id') return false
  if (fieldKey === 'createdAt' || fieldKey === 'updatedAt') {
    const hasDefault = 'defaultValue' in field && field.defaultValue !== undefined
    const isRequired =
      'validation' in field &&
      Object.entries(field.validation ?? {}).some(
        ([key, value]) => key === 'isRequired' && value === true,
      )
    if (hasDefault || !isRequired) return false
  }
  return true
}

type RelationStorage = Extract<DeclaredFieldStorage, { kind: 'relation' }>

function relationStorageOf(member: ListMember | undefined): RelationStorage | undefined {
  if (member?.kind !== 'field' || member.storage.kind !== 'relation') return undefined
  return member.storage
}

/**
 * Resolve `parentListKey.fieldName` as an edge across an explicit junction
 * list, or `null` when it is not one. Throws generate's own error on a config
 * `generate` refuses.
 *
 * It is one when the field is a to-many whose inverse on the junction list
 * owns the foreign key to the parent, exactly one other relationship field of
 * the junction list owns a foreign key — the far endpoint — and the list
 * carries no stored field of its own beyond those two links. `null` covers
 * everything else, where adding a related row is an update or a create of that
 * row against its own list rather than an edge.
 *
 * Known limits — each yields `null`, so a caller falls back to the ordinary
 * to-many treatment rather than getting a wrong answer:
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
  if (!Object.hasOwn(config.lists, parentListKey)) return null
  const field = relationStorageOf(resolveListMember(config, parentListKey, fieldName))
  if (field === undefined || !field.many) return null

  const junctionListKey = field.relatedList
  const backReferenceField = field.inverse.field
  const junction = resolveListMembers(config, junctionListKey)
  if (relationStorageOf(junction.members.get(backReferenceField))?.foreignKey === undefined) {
    return null
  }

  let target: { field: string; list: string } | null = null
  for (const member of junction.members.values()) {
    if (member.kind !== 'field' || member.name === backReferenceField) continue
    switch (member.storage.kind) {
      case 'relation':
        if (member.storage.foreignKey === undefined) continue
        // A third foreign key leaves the far endpoint ambiguous, and picking one
        // would silently drop the other from the created row.
        if (target !== null) return null
        target = { field: member.name, list: member.storage.relatedList }
        continue
      case 'computed':
        continue
      case 'column':
      case 'columns':
        if (carriesOwnData(member.name, member.field)) return null
        continue
      default: {
        const unhandled: never = member.storage
        return unhandled
      }
    }
  }

  if (target === null) return null

  return {
    junctionListKey,
    backReferenceField,
    targetField: target.field,
    targetListKey: target.list,
  }
}
