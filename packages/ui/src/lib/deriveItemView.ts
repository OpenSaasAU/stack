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
 * The default maximum number of related rows a Relationship table fetches and
 * renders (issue #752). The item view is a bounded preview — a record with many
 * related rows must not load/render every one on edit-page open — so each
 * to-many relationship is fetched with a `take` capped here unless the field's
 * `ui.itemView.take` overrides it. The totals footer still reports the full
 * access-scoped total ("showing N of M"), and the related list's own (paginated)
 * page remains the way to browse past the cap.
 */
export const DEFAULT_ITEM_VIEW_TAKE = 10

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
  /**
   * The maximum number of related rows to fetch and render for this table
   * (issue #752): the field's `ui.itemView.take` when it is a positive integer,
   * else {@link DEFAULT_ITEM_VIEW_TAKE}. The totals footer still shows the full
   * access-scoped total.
   */
  take: number
  /** Numeric columns to sum in the totals footer (explicit opt-in only). */
  sumColumns: string[]
  /**
   * The configured row-removal semantics (ADR-0018, issue #739), defaulting to
   * the non-destructive `'disconnect'`. `'delete'` truly deletes the related
   * row (confirmed); `'none'` hides the control.
   */
  removeAction: 'disconnect' | 'delete' | 'none'
  /**
   * Whether disconnect is statically possible for this relationship: there is a
   * back-reference field on the related list AND it is not a required foreign
   * key (`db.isNullable: false`). When `false`, a `'disconnect'` removeAction
   * has no control (a required FK cannot be nulled); `'delete'` is unaffected.
   */
  disconnectable: boolean
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

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? (value as string[])
    : undefined
}

/** Falls back to {@link DEFAULT_ITEM_VIEW_TAKE} for anything not a positive integer, so a malformed override can't disable the bound. */
function readPositiveInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_ITEM_VIEW_TAKE
}

/** `ui.itemView` is `unknown` (index-signature), so each property is narrowed at runtime instead of cast. */
function readRelationshipItemView(field: FieldConfig): {
  displayMode: 'table' | 'picker'
  columns?: string[]
  sum?: string[]
  take: number
  removeAction: 'disconnect' | 'delete' | 'none'
} {
  const raw: unknown = field.ui ? field.ui.itemView : undefined
  if (typeof raw !== 'object' || raw === null) {
    return { displayMode: 'table', take: DEFAULT_ITEM_VIEW_TAKE, removeAction: 'disconnect' }
  }
  const displayMode = 'displayMode' in raw && raw.displayMode === 'picker' ? 'picker' : 'table'
  const columns = 'columns' in raw ? readStringArray(raw.columns) : undefined
  const sum = 'sum' in raw ? readStringArray(raw.sum) : undefined
  const take = 'take' in raw ? readPositiveInteger(raw.take) : DEFAULT_ITEM_VIEW_TAKE
  const removeAction =
    'removeAction' in raw && (raw.removeAction === 'delete' || raw.removeAction === 'none')
      ? raw.removeAction
      : 'disconnect'
  return { displayMode, columns, sum, take, removeAction }
}

/**
 * Whether a to-many relationship's rows can be disconnected (ADR-0018): the
 * related list must expose a back-reference field to unlink through, and that
 * field must not be a required foreign key (`db.isNullable: false`), which the
 * schema would make impossible to null. List-only refs (no back-reference)
 * cannot be disconnected via the related list and are treated as not
 * disconnectable.
 */
function isDisconnectable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig is generic over TypeInfo
  relatedListConfig: ListConfig<any> | undefined,
  backReferenceField: string | undefined,
): boolean {
  if (!relatedListConfig || !backReferenceField) return false
  const backRefField = relatedListConfig.fields[backReferenceField]
  if (!backRefField) return false
  return backRefField.db?.isNullable !== false
}

function isToManyRelationship(field: FieldConfig): boolean {
  return field.type === 'relationship' && 'many' in field && field.many === true
}

/** The related list's own column curation (`ui.listView.initialColumns`, else all non-system fields), minus the back-reference to the parent. */
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

/** Reorder sections by `ui.itemView.order`; unlisted sections keep their declaration order after the listed ones. */
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
        take: overrides.take,
        sumColumns: overrides.sum ?? [],
        removeAction: overrides.removeAction,
        disconnectable: isDisconnectable(relatedListConfig, backReferenceField),
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
