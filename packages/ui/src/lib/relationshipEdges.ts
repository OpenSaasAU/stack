import type { FieldConfig, OpenSaasConfig } from '@opensaas/stack-core'
import { resolveJunctionEdge } from '@opensaas/stack-core'
import { isRelationshipField, shouldHaveForeignKey } from '@opensaas/stack-core/fields'

/**
 * Whether a field declares `validation: { isRequired: true }`.
 *
 * `RelationshipField` does not declare `validation`, so this reads it
 * structurally: a config can still carry it (the builder spreads its options
 * through), and a back-reference the author calls required must not get a
 * control whose deselect the author means to refuse.
 */
function declaresRequired(field: FieldConfig): boolean {
  if (!('validation' in field)) return false
  const validation: unknown = field.validation
  if (typeof validation !== 'object' || validation === null) return false
  return 'isRequired' in validation && validation.isRequired === true
}

/**
 * How one to-many relationship's edges are written from the item form: as
 * writes against the RELATED list, one per edge (ADR-0050).
 *
 * The parent record holds no column for a to-many, so its own update payload
 * can never carry the edge — and connecting through the inverse field no
 * longer compiles. What does hold the link is the related row's own foreign
 * key, so adding an edge is an update of that row and removing one is nulling
 * the same column, both evaluated against {@link relatedListKey}'s access.
 */
export interface ToManyEdgePlan {
  /** The list whose rows carry the foreign key, and whose access decides each write. */
  relatedListKey: string
  /** That list's to-one field holding the link back to the parent record. */
  backReferenceField: string
}

/**
 * Resolve how `listKey.fieldName`'s edges are written, or `null` when the item
 * form must not offer to write them.
 *
 * `null` covers, each keeping the field read-only rather than rendering a
 * control whose writes have nowhere to land:
 * - anything but a to-many with a bidirectional `ref` — a list-only `ref`
 *   (`ref: 'Post'`) names no back-reference to write through;
 * - a back-reference that is itself to-many, or that does not own the foreign
 *   key — neither has a column on the related row to hold the parent;
 * - a back-reference declared `db.isNullable: false` or
 *   `validation: { isRequired: true }`, where deselecting could
 *   not be written at all and the control would accept an edit it must then
 *   refuse;
 * - an edge across an explicit junction list, whose rows are created and
 *   deleted under the junction list's own access by the relationship table's
 *   link control (#1329), never by an update of an existing row.
 */
export function resolveToManyEdgePlan(
  config: OpenSaasConfig,
  listKey: string,
  fieldName: string,
): ToManyEdgePlan | null {
  if (!Object.hasOwn(config.lists, listKey)) return null
  const listConfig = config.lists[listKey]
  if (!Object.hasOwn(listConfig.fields, fieldName)) return null
  const field = listConfig.fields[fieldName]
  if (!isRelationshipField(field) || field.many !== true) return null

  const [relatedListKey, backReferenceField] = field.ref.split('.')
  if (!backReferenceField) return null
  if (!Object.hasOwn(config.lists, relatedListKey)) return null

  const relatedListConfig = config.lists[relatedListKey]
  if (!Object.hasOwn(relatedListConfig.fields, backReferenceField)) return null
  const backReference = relatedListConfig.fields[backReferenceField]
  if (!isRelationshipField(backReference) || backReference.many === true) return null
  if (backReference.db?.isNullable === false) return null
  if (declaresRequired(backReference)) return null

  // `shouldHaveForeignKey` throws on a config `generate` would have refused.
  // This runs while rendering a page, so an unvalidated config leaves the
  // field read-only rather than failing the render.
  try {
    if (!shouldHaveForeignKey(relatedListKey, backReferenceField, backReference, config)) {
      return null
    }
  } catch {
    return null
  }

  if (resolveJunctionEdge(config, listKey, fieldName)) return null

  return { relatedListKey, backReferenceField }
}
