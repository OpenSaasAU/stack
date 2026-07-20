import {
  getItemLabel,
  getUrlKey,
  type AccessContext,
  type OpenSaasConfig,
  type FieldConfig,
  type ListConfig,
} from '@opensaas/stack-core'
import { formatFieldName, formatListName } from '../lib/utils.js'
import { serializeFieldConfig, type SerializableFieldConfig } from '../lib/serializeFieldConfig.js'
import {
  isOperationPotentiallyAllowed,
  isFieldPotentiallyWritable,
} from '../lib/operationAccess.js'
import { prepareItemForm } from '../lib/prepareItemForm.js'
import type { RelationshipTableSection } from '../lib/deriveItemView.js'
import type { ServerActionInput } from '../server/types.js'
import { RelationshipTableClient, type RemoveMode } from './RelationshipTableClient.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig is generic over TypeInfo
type AnyListConfig = ListConfig<any>

export interface RelationshipTableProps {
  config: OpenSaasConfig
  /** The derived section describing this to-many relationship. */
  section: RelationshipTableSection
  /**
   * The parent record's related rows for this relationship, already fetched and
   * access-filtered through the secured context (`context.db` include) and
   * BOUNDED by the section's `take` (issue #752). Only access-visible rows/fields
   * are present here, and at most `section.take` of them.
   */
  rows: Array<Record<string, unknown>>
  /**
   * The full access-scoped total of related rows (M in "showing N of M", issue
   * #752): the count the secured context reports through a filtered `_count`,
   * folding the related list's own `query` access in — always ≥ `rows.length`,
   * and 0 (never a leaked true total) for a denied related list.
   */
  total: number
  basePath: string
  /**
   * The access-scoped context, used to evaluate the related list's operation
   * access so a removal control is only offered when the session may perform it.
   */
  context: AccessContext<unknown>
  /** The list being edited (the parent record's list). */
  parentListKey: string
  /** The parent record's id — the disconnect target for many-to-many rows. */
  parentId: string
  /** Server action that runs removals through the secured context. */
  serverAction: (input: ServerActionInput) => Promise<unknown>
}

/**
 * Decide which removal control (if any) a row should show (ADR-0018, #739).
 *
 * The configured `removeAction` is the ceiling; operation-level access on the
 * RELATED list is the gate. A hard deny (no update/delete access at all) hides
 * the control — no affordance for what will always fail. A filter result is
 * treated as "potentially allowed", so the control shows and a row-level denial
 * surfaces at commit time as a Silent failure (row stays, reason shown).
 */
async function resolveRemoveMode(
  section: RelationshipTableSection,
  relatedListConfig: AnyListConfig | undefined,
  context: AccessContext<unknown>,
): Promise<RemoveMode> {
  if (section.removeAction === 'none' || !relatedListConfig) return null

  const access = relatedListConfig.access?.operation
  const args = { session: context.session, context }

  if (section.removeAction === 'delete') {
    return (await isOperationPotentiallyAllowed(access, 'delete', args)) ? 'delete' : null
  }

  // Default: disconnect — only where the schema allows it (nullable back-ref FK)
  // and the related list's update access is not hard-denied.
  if (!section.disconnectable) return null
  return (await isOperationPotentiallyAllowed(access, 'update', args)) ? 'disconnect' : null
}

/** Columns never inline-editable regardless of access (system + write-excluded). */
const NON_EDITABLE_COLUMNS = new Set(['id', 'createdAt', 'updatedAt'])

/**
 * The subset of columns whose cells may be inline-edited (issue #737, ADR-0018).
 *
 * Gating mirrors #738/#739: the RELATED list's own operation-level update access
 * is the table gate — a hard deny yields no editable cells, so a fully
 * update-denied table stays read-only. Each column is then editable only when it
 * is a writable scalar field of the related list, EXCLUDING:
 * - relationship columns (relationship editing is out of scope here — they render
 *   as `{ id, label }` and stay read-only),
 * - virtual/computed fields (not stored; nothing to write),
 * - password fields and system columns (`id`/`createdAt`/`updatedAt`),
 * - any field whose UPDATE field-access is statically denied.
 *
 * A field-access rule that returns a filter or depends on the row is treated as
 * "potentially writable": the affordance shows and a row-level denial surfaces at
 * commit as a revert (never a denied-vs-absent leak). All evaluation is on the
 * related list's own access — never the parent's.
 */
async function resolveEditableColumns(
  section: RelationshipTableSection,
  relatedListConfig: AnyListConfig | undefined,
  context: AccessContext<unknown>,
): Promise<string[]> {
  if (!relatedListConfig) return []

  const tableUpdatable = await isOperationPotentiallyAllowed(
    relatedListConfig.access?.operation,
    'update',
    { session: context.session, context },
  )
  if (!tableUpdatable) return []

  const editable: string[] = []
  for (const column of section.columns) {
    if (NON_EDITABLE_COLUMNS.has(column)) continue
    const field = relatedListConfig.fields[column]
    if (!field) continue
    if (field.type === 'relationship') continue
    if (field.type === 'password') continue
    if ('virtual' in field && field.virtual) continue
    if (await isFieldPotentiallyWritable(field.access, { session: context.session, context })) {
      editable.push(column)
    }
  }
  return editable
}

/** The serialisable props the pre-linked create drawer needs, or `null` to hide it. */
interface CreateFormData {
  fields: Record<string, SerializableFieldConfig>
  relationshipData: Record<string, Array<{ id: string; label: string }>>
}

/**
 * Prepare the pre-linked create drawer (#738) for this table, or `null` when it
 * should not be offered.
 *
 * Gating (ADR-0018): the "+ Add" is shown only when
 * - a back-reference field exists to preset the link (list-only refs have none,
 *   so cannot be pre-linked and are excluded — mirroring #739's disconnect), and
 * - the RELATED list's own `create` access is not statically denied. A hard deny
 *   (no create rule, or `create` returns `false`) hides the control — no
 *   affordance for what will always fail. A filter/function result is
 *   "potentially allowed", so the control shows and a row-level denial surfaces
 *   at commit time as a Silent failure (generic reason, no denied-vs-absent leak).
 *
 * The create form is the related list's fields with the back-reference removed —
 * it is preset + hidden, set on the server from the parent id — so the drawer
 * still enforces the related list's full validation and required fields (issue
 * #738's reason for a drawer over an inline draft row).
 */
async function resolveCreateForm(
  section: RelationshipTableSection,
  relatedListConfig: AnyListConfig | undefined,
  config: OpenSaasConfig,
  context: AccessContext<unknown>,
): Promise<CreateFormData | null> {
  if (!section.backReferenceField || !relatedListConfig) return null

  const allowed = await isOperationPotentiallyAllowed(
    relatedListConfig.access?.operation,
    'create',
    { session: context.session, context },
  )
  if (!allowed) return null

  const formFields: Record<string, FieldConfig> = {}
  for (const [key, field] of Object.entries(relatedListConfig.fields)) {
    if (key === section.backReferenceField) continue
    formFields[key] = field
  }
  const formListConfig: AnyListConfig = { ...relatedListConfig, fields: formFields }

  const { serializableFields, relationshipData } = await prepareItemForm(
    context,
    config,
    formListConfig,
    {},
  )
  return { fields: serializableFields, relationshipData }
}

/**
 * Resolve a fetched relationship column value (a related record, or an array of
 * them, or `null`) into the `{ id, label }` shape the cell registry's
 * relationship Cell renders — using the shared label seam so it never drifts
 * from the list page's relationship cells.
 */
function toRelationshipCellValue(
  value: unknown,
  relatedListConfig: AnyListConfig | undefined,
): unknown {
  if (!relatedListConfig || value == null) return value
  const resolveOne = (entry: unknown): unknown => {
    if (!entry || typeof entry !== 'object' || !('id' in entry)) return entry
    const row = entry as Record<string, unknown>
    return { id: String(row.id), label: getItemLabel(relatedListConfig, row) }
  }
  return Array.isArray(value) ? value.map(resolveOne) : resolveOne(value)
}

/**
 * Serialised config for a Relationship-table column. Columns are usually
 * declared fields on the related list; a column that isn't (e.g. an explicit
 * `id`/`createdAt` override) falls back to a minimal text/timestamp config so
 * the cell registry can still resolve a Cell.
 */
function columnFieldConfig(
  column: string,
  relatedListConfig: AnyListConfig | undefined,
): SerializableFieldConfig {
  const field = relatedListConfig?.fields[column] as FieldConfig | undefined
  if (field) return serializeFieldConfig(field)
  if (column === 'createdAt' || column === 'updatedAt') return { type: 'timestamp' }
  return { type: 'text' }
}

/** Coerce a cell value to a number for footer summing, or `null` if not numeric. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Relationship table (issue #734) — a section of the item view showing a
 * to-many relationship's related rows. Server Component: it resolves columns,
 * cells (via the shared serialise path), the totals footer sums, and the
 * per-row/per-cell affordances (removal #739, create drawer #738, inline cell
 * edit #737) from rows already fetched through the secured context, then hands
 * minimal, serialisable props to {@link RelationshipTableClient}.
 *
 * Inline cell edit (#737): {@link resolveEditableColumns} decides — from the
 * RELATED list's own operation- and field-level update access — which columns
 * may be edited in place; that set is passed as `editableColumns`. Every commit
 * runs on the related list through the secured context, never the parent's.
 */
export async function RelationshipTable({
  config,
  section,
  rows,
  total,
  basePath,
  context,
  parentListKey,
  parentId,
  serverAction,
}: RelationshipTableProps) {
  const relatedListConfig = config.lists[section.relatedListKey]
  const relatedUrlKey = getUrlKey(section.relatedListKey)

  // Which removal control (if any) this table's rows may show, gated on the
  // related list's own operation access (never the parent's).
  const removeMode = await resolveRemoveMode(section, relatedListConfig, context)

  // The pre-linked create drawer (#738), gated on the related list's own create
  // access (never the parent's) and the presence of a back-reference to preset.
  const createForm = await resolveCreateForm(section, relatedListConfig, config, context)

  // Which columns may be inline-edited (#737), gated on the related list's own
  // operation- and field-level update access (never the parent's).
  const editableColumns = await resolveEditableColumns(section, relatedListConfig, context)

  // The related list config for each relationship column, keyed by column, so
  // its values can be label-resolved via that column's OWN target list (a
  // `Post.author` column resolves against User, not Post).
  const columnRelatedList = new Map<string, AnyListConfig | undefined>()
  for (const column of section.columns) {
    const columnField = relatedListConfig?.fields[column]
    if (columnField?.type === 'relationship' && 'ref' in columnField) {
      const targetKey =
        typeof columnField.ref === 'string' ? columnField.ref.split('.')[0] : undefined
      columnRelatedList.set(column, targetKey ? config.lists[targetKey] : undefined)
    }
  }

  // Resolve relationship-column values to { id, label } and drop everything
  // outside the shown columns (keeping `id` for the row link).
  const preparedRows = rows.map((row) => {
    const prepared: Record<string, unknown> = { id: row.id }
    for (const column of section.columns) {
      prepared[column] = columnRelatedList.has(column)
        ? toRelationshipCellValue(row[column], columnRelatedList.get(column))
        : row[column]
    }
    return prepared
  })

  // Sum only explicitly-configured numeric columns, over access-visible values.
  const sums: Record<string, number> = {}
  for (const column of section.sumColumns) {
    sums[column] = rows.reduce((total, row) => {
      const numeric = toNumber(row[column])
      return numeric === null ? total : total + numeric
    }, 0)
  }

  const fields: Record<string, SerializableFieldConfig> = {}
  for (const column of section.columns) {
    fields[column] = columnFieldConfig(column, relatedListConfig)
  }

  // JSON round-trip so only serialisable data crosses to the client component.
  const serializedRows = JSON.parse(JSON.stringify(preparedRows)) as Array<Record<string, unknown>>

  return (
    <RelationshipTableClient
      title={formatFieldName(section.fieldName)}
      relatedUrlKey={relatedUrlKey}
      basePath={basePath}
      columns={section.columns}
      fields={fields}
      rows={serializedRows}
      count={rows.length}
      total={total}
      sumColumns={section.sumColumns}
      sums={sums}
      removeMode={removeMode}
      relatedListKey={section.relatedListKey}
      backReferenceField={section.backReferenceField}
      parentId={parentId}
      parentListKey={parentListKey}
      serverAction={serverAction}
      canCreate={createForm !== null}
      createFields={createForm?.fields}
      createRelationshipData={createForm?.relationshipData}
      relatedListTitle={formatListName(section.relatedListKey)}
      editableColumns={editableColumns}
    />
  )
}
