import type { FieldConfig, ListConfig, OpenSaasConfig } from '@opensaas/stack-core'

/**
 * The container arrangement of an item view, DERIVED from the number of
 * to-many relationships rendered as Relationship tables (issue #734):
 * - `single`: no Relationship tables → a single, centered details card.
 * - `split`: exactly one Relationship table → a two-column split (details card
 *   beside the table).
 * - `stacked`: several Relationship tables → details card on top, tables
 *   stacked beneath it.
 */
export type ItemViewArrangement = 'single' | 'split' | 'stacked'

/**
 * One derived Relationship-table section — a to-many relationship on the record
 * being edited, rendered read-only as a table of related rows.
 */
export interface RelationshipTableSection {
  /** The to-many relationship field name on the parent list. */
  fieldName: string
  /** The relationship `ref` (`'List.field'` or `'List'`). */
  ref: string
  /** The related list this table shows rows of. */
  relatedListKey: string
  /**
   * The related list's field that points back at the parent record, derived
   * from the `ref` (`'Post.author'` → `author`). Stripped from the default
   * columns and used nowhere else. `undefined` for list-only refs.
   */
  backReferenceField?: string
  /** The related-list columns to show, in order (curation minus back-reference). */
  columns: string[]
  /** Numeric columns to sum in the totals footer (explicit opt-in only). */
  sumColumns: string[]
}

/**
 * The complete derived item-view layout: which fields belong in the details
 * card, which to-many relationships become Relationship tables, and the
 * arrangement that follows from their count.
 */
export interface ItemViewLayout {
  /** Field names for the details card (scalars, to-one, demoted to-many pickers). */
  detailsFields: string[]
  /** Relationship-table sections, in placement order. */
  sections: RelationshipTableSection[]
  /** Container arrangement derived from `sections.length`. */
  arrangement: ItemViewArrangement
}

/**
 * Related-list columns that are never shown by default, mirroring the list
 * view's own default curation (`ListViewClient`): system timestamp columns and
 * password fields.
 */
const DEFAULT_EXCLUDED_COLUMNS = new Set(['password', 'createdAt', 'updatedAt'])

/** Read an array of strings from an unknown config value, else `undefined`. */
function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? (value as string[])
    : undefined
}

/**
 * Read a to-many relationship's item-view overrides off its serialisable `ui`
 * config without casting: `ui.itemView` is `unknown` (index-signature) so each
 * property is narrowed at runtime.
 */
function readRelationshipItemView(field: FieldConfig): {
  displayMode: 'table' | 'picker'
  columns?: string[]
  sum?: string[]
} {
  const raw: unknown = field.ui ? field.ui.itemView : undefined
  if (typeof raw !== 'object' || raw === null) {
    return { displayMode: 'table' }
  }
  const displayMode = 'displayMode' in raw && raw.displayMode === 'picker' ? 'picker' : 'table'
  const columns = 'columns' in raw ? readStringArray(raw.columns) : undefined
  const sum = 'sum' in raw ? readStringArray(raw.sum) : undefined
  return { displayMode, columns, sum }
}

/** Whether a field config is a to-many relationship. */
function isToManyRelationship(field: FieldConfig): boolean {
  return field.type === 'relationship' && 'many' in field && field.many === true
}

/**
 * The default columns for a related list's Relationship table: the list's own
 * column curation (`ui.listView.initialColumns`, else all non-system fields),
 * with the back-reference to the parent removed.
 */
function defaultColumnsFor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig is generic over TypeInfo
  relatedListConfig: ListConfig<any> | undefined,
  backReferenceField: string | undefined,
): string[] {
  if (!relatedListConfig) return []
  const curated =
    relatedListConfig.ui?.listView?.initialColumns ??
    Object.keys(relatedListConfig.fields).filter((key) => !DEFAULT_EXCLUDED_COLUMNS.has(key))
  return curated.filter((column) => column !== backReferenceField)
}

/**
 * Reorder sections by the list's `ui.itemView.order` (by relationship field
 * name). Listed fields come first in that order; unlisted sections keep their
 * relative (declaration) order after them.
 */
function applyOrder(
  sections: RelationshipTableSection[],
  order: string[] | undefined,
): RelationshipTableSection[] {
  if (!order || order.length === 0) return sections
  const rank = new Map(order.map((name, index) => [name, index]))
  return sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => {
      const ra = rank.get(a.section.fieldName)
      const rb = rank.get(b.section.fieldName)
      if (ra !== undefined && rb !== undefined) return ra - rb
      if (ra !== undefined) return -1
      if (rb !== undefined) return 1
      return a.index - b.index // stable: preserve declaration order
    })
    .map((entry) => entry.section)
}

/**
 * Derive the item-view layout from a list's shape (issue #734).
 *
 * Pure and config-only (no I/O), so the zero / one / several arrangements are
 * unit-testable: every to-many relationship not demoted to the picker becomes a
 * Relationship-table section, everything else is a details-card field, and the
 * arrangement follows from the section count. Item-view config (`ui.itemView`
 * on the list for ordering; `ui.itemView` on the relationship for
 * columns/sum/picker) refines this without changing the derivation rule.
 */
export function deriveItemViewLayout(config: OpenSaasConfig, listKey: string): ItemViewLayout {
  const listConfig = config.lists[listKey]
  const detailsFields: string[] = []
  let sections: RelationshipTableSection[] = []

  if (!listConfig) {
    return { detailsFields, sections, arrangement: 'single' }
  }

  for (const [fieldName, field] of Object.entries(listConfig.fields)) {
    const overrides = isToManyRelationship(field) ? readRelationshipItemView(field) : undefined

    // A to-many relationship becomes a Relationship table unless demoted to the
    // compact picker, which keeps it in the details card (pre-#734 behaviour).
    if (overrides && overrides.displayMode === 'table' && 'ref' in field) {
      const ref = typeof field.ref === 'string' ? field.ref : ''
      const [relatedListKey, backReferenceField] = ref.split('.')
      const relatedListConfig = config.lists[relatedListKey]
      sections.push({
        fieldName,
        ref,
        relatedListKey,
        backReferenceField,
        columns: overrides.columns ?? defaultColumnsFor(relatedListConfig, backReferenceField),
        sumColumns: overrides.sum ?? [],
      })
    } else {
      detailsFields.push(fieldName)
    }
  }

  sections = applyOrder(sections, listConfig.ui?.itemView?.order)

  const arrangement: ItemViewArrangement =
    sections.length === 0 ? 'single' : sections.length === 1 ? 'split' : 'stacked'

  return { detailsFields, sections, arrangement }
}
