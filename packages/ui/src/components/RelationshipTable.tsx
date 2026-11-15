import { applyClientValueTransforms } from '../lib/clientValueTransforms.js'
import { resolveListUi } from '../lib/resolveListUi.js'
import {
  getItemLabel,
  getUrlKey,
  resolveJunctionEdge,
  engineContextOf,
  type AccessContext,
  type AnyStackContext,
  type OpenSaasConfig,
  type FieldConfig,
  type ListConfig,
} from '@opensaas/stack-core'
import { formatFieldName, formatListName } from '../lib/utils.js'
import { projectFieldConfig, type SerializableFieldConfig } from '../lib/serializeFieldConfig.js'
import { jsonSafeClone } from '../lib/jsonSafeClone.js'
import type { SessionVocabulary } from '@opensaas/stack-core/internal'
import { vocabularyOrDeny, withheldFieldNames } from '../lib/sessionFieldConfigs.js'
import { vocabularyQuestionsOrDeny } from '../lib/vocabularyQuestions.js'
import { prepareItemForm } from '../lib/prepareItemForm.js'
import type { RelationshipTableSection } from '../lib/deriveItemView.js'
import { resolveToManyEdgePlan } from '../lib/relationshipEdges.js'
import type { ServerActionInput } from '../server/types.js'
import { RelationshipTableClient, type RemoveMode } from './RelationshipTableClient.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig is generic over TypeInfo
type AnyListConfig = ListConfig<any>

export interface RelationshipTableProps {
  config: OpenSaasConfig
  section: RelationshipTableSection
  /**
   * The parent record's related rows for this relationship, already fetched and
   * access-filtered through the secured context (`context.db` include) and
   * BOUNDED by the section's `take` (issue #752).
   */
  rows: Array<Record<string, unknown>>
  /**
   * The full access-scoped total of related rows (M in "showing N of M", issue
   * #752): the count the secured context reports through a filtered `_count`,
   * folding the related list's own `query` access in — always ≥ `rows.length`,
   * and 0 (never a leaked true total) for a denied related list.
   */
  total: number
  /** The read withheld this relation, so `rows` and `total` say nothing about it. */
  unavailable?: boolean
  basePath: string
  /**
   * The access-scoped context, used to evaluate the related list's own access
   * (removal, create, and inline-edit gating) — never the parent's.
   */
  context: AnyStackContext
  /** The list being edited (the parent record's list). */
  parentListKey: string
  /** The parent record's id — the link the pre-linked create drawer presets. */
  parentId: string
  /** Server action that runs removals through the secured context. */
  serverAction: (input: ServerActionInput) => Promise<unknown>
  /** Suppress every write affordance — set when the parent's item view is in `'read'` field mode. */
  readOnly?: boolean
}

/**
 * Decide which removal control (if any) a row should show (ADR-0018, #739).
 * The configured `removeAction` is the ceiling; the RELATED list's Session
 * vocabulary is the gate, and only a deny withholds the control. A row the
 * rule denies surfaces at commit time as a Silent failure (row stays, reason
 * shown).
 */
async function resolveRemoveMode(
  section: RelationshipTableSection,
  relatedListConfig: AnyListConfig,
  relatedVocabulary: SessionVocabulary,
  context: AccessContext,
): Promise<RemoveMode> {
  if (section.removeAction === 'none') return null

  if (section.removeAction === 'delete') {
    if (relatedVocabulary.operations.delete === 'deny') return null
    return (await resolveListUi(relatedListConfig, context)).hideDelete ? null : 'delete'
  }

  if (!section.disconnectable || !section.backReferenceField) return null
  if (relatedVocabulary.operations.update === 'deny') return null
  if (relatedVocabulary.fields.get(section.backReferenceField)?.update === 'deny') return null
  return 'disconnect'
}

/** Columns never inline-editable regardless of access (system + write-excluded). */
const NON_EDITABLE_COLUMNS = new Set(['id', 'createdAt', 'updatedAt'])

/**
 * The subset of columns whose cells may be inline-edited (issue #737, ADR-0018).
 *
 * The RELATED list's Session vocabulary is the gate: its `update` operation
 * answering deny yields no editable cells. Each column is then editable only
 * when it is a writable scalar field of the related list, EXCLUDING:
 * - relationship columns (relationship editing is out of scope here — they render
 *   as `{ id, label }` and stay read-only),
 * - virtual/computed fields (not stored; nothing to write),
 * - json columns (their draft is a fresh object reference, so the no-op
 *   `draft === displayValue` guard never holds and an unchanged cell would waste
 *   a round-trip; they also need a proper structured editor — out of scope here),
 * - password fields and system columns (`id`/`createdAt`/`updatedAt`),
 * - any field whose `update` answer in the vocabulary is deny.
 *
 * A row-dependent answer keeps the cell editable; the secured commit decides
 * it for the row.
 */
export function resolveEditableColumns(
  section: RelationshipTableSection,
  relatedListConfig: AnyListConfig,
  relatedVocabulary: SessionVocabulary,
): string[] {
  if (relatedVocabulary.operations.update === 'deny') return []

  const editable: string[] = []
  for (const column of section.columns) {
    if (NON_EDITABLE_COLUMNS.has(column)) continue
    const field = relatedListConfig.fields[column]
    if (!field) continue
    if (field.type === 'relationship') continue
    if (field.type === 'password') continue
    if (field.type === 'json') continue
    if ('virtual' in field && field.virtual) continue
    const update = relatedVocabulary.fields.get(column)?.update
    if (update !== undefined && update !== 'deny') editable.push(column)
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
 * - the RELATED list's Session vocabulary denies neither `create` nor the
 *   back-reference field's own `create`, which the drawer presets.
 *
 * The create form is the related list's fields with the back-reference removed —
 * it is preset + hidden, set on the server from the parent id — so the drawer
 * still enforces the related list's full validation and required fields (issue
 * #738's reason for a drawer over an inline draft row).
 */
async function resolveCreateForm(
  section: RelationshipTableSection,
  relatedListConfig: AnyListConfig,
  relatedVocabulary: SessionVocabulary,
  config: OpenSaasConfig,
  context: AccessContext,
): Promise<CreateFormData | null> {
  if (!section.backReferenceField) return null
  if (relatedVocabulary.operations.create === 'deny') return null
  if (relatedVocabulary.fields.get(section.backReferenceField)?.create === 'deny') return null

  if ((await resolveListUi(relatedListConfig, context)).hideCreate) return null

  const formFields: Record<string, FieldConfig> = {}
  for (const [key, field] of Object.entries(relatedListConfig.fields)) {
    if (key === section.backReferenceField) continue
    formFields[key] = field
  }
  const formListConfig: AnyListConfig = { ...relatedListConfig, fields: formFields }

  const { serializableFields, relationshipData } = await prepareItemForm(
    context,
    config,
    section.relatedListKey,
    formListConfig,
    {},
    'create',
  )
  return { fields: serializableFields, relationshipData }
}

/**
 * The serialisable props the "Link existing" control needs, or `null` to hide
 * it. The two shapes are the two ways an edge is stored, and each names the
 * list its write is evaluated against (ADR-0050):
 * - `junction`: a row of an explicit junction list, created under that list's
 *   create access (#1329);
 * - `foreignKey`: the related row's own back-reference column, set under the
 *   related list's update access.
 */
export type LinkEdgeData =
  | {
      mode: 'junction'
      junctionListKey: string
      targetField: string
      targetListKey: string
    }
  | {
      mode: 'foreignKey'
      relatedListKey: string
      backReferenceField: string
      targetListKey: string
    }

/**
 * Prepare the add-an-edge control for this table, or `null` when it should not
 * be offered (#1329).
 *
 * The gate is the Session vocabulary of the list the write is actually
 * evaluated against — the junction list's `create`, and its two foreign keys'
 * own `create`, for an edge across one; the related list's `update`, and its
 * back-reference field's own `update`, for an edge held in its own foreign
 * key — never the parent's. The edge is resolved from `context`'s own config,
 * the one that vocabulary reads, and a list it cannot answer for gets no
 * control. Only a deny hides the control: a row-dependent rule that denies
 * still denies at commit, silently, so the control is a ceiling and never a
 * promise.
 *
 * A to-many whose edges cannot be written at all
 * ({@link resolveToManyEdgePlan} returning `null` — a list-only `ref`, a
 * required back-reference) gets no control.
 *
 * This resolves only whether the control is offered — it does NOT fetch the
 * far endpoint's options. Reading those eagerly, on every render of every
 * to-many section whether or not the user ever opens the control, was the
 * defect issue #1365 fixed: the client now loads them itself, through the
 * same bounded, access-scoped `relationshipOptions` op the live search uses,
 * the first time the control opens (see {@link RelationshipLinkControl}).
 */
export async function resolveLinkEdge(
  section: RelationshipTableSection,
  parentListKey: string,
  context: AnyStackContext,
): Promise<LinkEdgeData | null> {
  const config = engineContextOf(context)._config
  if (!config) return null

  const edge = resolveJunctionEdge(config, parentListKey, section.fieldName)
  if (edge) {
    const junction = vocabularyQuestionsOrDeny(context, edge.junctionListKey)
    if (junction === null || (await junction.operation('create')) === 'deny') return null
    if ((await junction.field(edge.backReferenceField)?.create()) === 'deny') return null
    if ((await junction.field(edge.targetField)?.create()) === 'deny') return null

    return {
      mode: 'junction',
      junctionListKey: edge.junctionListKey,
      targetField: edge.targetField,
      targetListKey: edge.targetListKey,
    }
  }

  const plan = resolveToManyEdgePlan(config, parentListKey, section.fieldName)
  if (!plan) return null

  const related = vocabularyQuestionsOrDeny(context, plan.relatedListKey)
  if (related === null || (await related.operation('update')) === 'deny') return null
  if ((await related.field(plan.backReferenceField)?.update()) === 'deny') return null

  return {
    mode: 'foreignKey',
    relatedListKey: plan.relatedListKey,
    backReferenceField: plan.backReferenceField,
    targetListKey: plan.relatedListKey,
  }
}

/**
 * Resolve a fetched relationship column value (a related record, or an array of
 * them, or `null`) into the `{ id, label }` shape the cell registry's
 * relationship Cell renders — using the shared label seam so it never drifts
 * from the list page's relationship cells.
 */
function toRelationshipCellValue(value: unknown, relatedListConfig: AnyListConfig | null): unknown {
  if (value == null) return value
  if (!relatedListConfig) return Array.isArray(value) ? [] : null
  const resolveOne = (entry: unknown): unknown => {
    if (!entry || typeof entry !== 'object' || !('id' in entry)) return entry
    const row = applyClientValueTransforms(
      relatedListConfig.fields,
      entry as Record<string, unknown>,
    )
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
  relatedListConfig: AnyListConfig,
): SerializableFieldConfig {
  const field = relatedListConfig.fields[column] as FieldConfig | undefined
  if (field) return projectFieldConfig(field)
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
 * Everything it tells the client about the related list — the columns it
 * shows, which cells may be edited in place, its removal, create and link
 * controls — is read from that list's own Session vocabulary, never the
 * parent's. A relationship column's labels are resolved only where the session
 * may query that column's own target list. Every commit runs on the related
 * list through the secured context.
 */
export async function RelationshipTable({
  config: propConfig,
  section,
  rows,
  total,
  unavailable = false,
  basePath,
  context: appContext,
  parentListKey,
  parentId,
  serverAction,
  readOnly = false,
}: RelationshipTableProps) {
  const context = engineContextOf(appContext)
  const config = context._config ?? propConfig
  const relatedUrlKey = getUrlKey(section.relatedListKey)
  const relatedListConfig = Object.hasOwn(config.lists, section.relatedListKey)
    ? config.lists[section.relatedListKey]
    : undefined
  const relatedVocabulary = relatedListConfig
    ? await vocabularyOrDeny(context, section.relatedListKey)
    : null

  if (!relatedListConfig || !relatedVocabulary || relatedVocabulary.operations.query === 'deny') {
    return (
      <RelationshipTableClient
        title={formatFieldName(section.fieldName)}
        relatedUrlKey={relatedUrlKey}
        basePath={basePath}
        columns={[]}
        fields={{}}
        rows={[]}
        count={0}
        total={0}
        unavailable
        sumColumns={[]}
        sums={{}}
        removeMode={null}
        relatedListKey={section.relatedListKey}
        backReferenceField={section.backReferenceField}
        parentId={parentId}
        parentListKey={parentListKey}
        serverAction={serverAction}
        fieldName={section.fieldName}
        canCreate={false}
        relatedListTitle={formatListName(section.relatedListKey)}
        editableColumns={[]}
      />
    )
  }

  const unreadable = withheldFieldNames(
    relatedVocabulary,
    [...section.columns, ...section.sumColumns],
    'display',
  )
  const shownColumns = section.columns.filter((column) => !unreadable.has(column))
  const shownSumColumns = section.sumColumns.filter((column) => !unreadable.has(column))

  const columnRelatedList = new Map<string, AnyListConfig | null>()
  const [removeMode, createForm, linkEdge] = await Promise.all([
    readOnly ? null : resolveRemoveMode(section, relatedListConfig, relatedVocabulary, context),
    readOnly
      ? null
      : resolveCreateForm(section, relatedListConfig, relatedVocabulary, config, context),
    readOnly ? null : resolveLinkEdge(section, parentListKey, context),
    ...shownColumns.map(async (column) => {
      const targetKey = relatedVocabulary.fields.get(column)?.relationship?.targetList
      if (targetKey === undefined) return
      const target = Object.hasOwn(config.lists, targetKey) ? config.lists[targetKey] : null
      const targetQuestions = target === null ? null : vocabularyQuestionsOrDeny(context, targetKey)
      const queryable =
        targetQuestions !== null && (await targetQuestions.operation('query')) !== 'deny'
      columnRelatedList.set(column, queryable ? target : null)
    }),
  ])
  const editableColumns = readOnly
    ? []
    : resolveEditableColumns(section, relatedListConfig, relatedVocabulary)

  // Resolve relationship-column values to { id, label } and drop everything
  // outside the shown columns (keeping `id` for the row link).
  const shownFields: Record<string, FieldConfig> = {}
  for (const column of shownColumns) {
    const field = relatedListConfig.fields[column]
    if (field) shownFields[column] = field
  }
  const preparedRows = rows.map((row) => {
    const prepared: Record<string, unknown> = { id: row.id }
    for (const column of shownColumns) {
      const target = columnRelatedList.get(column)
      prepared[column] =
        target === undefined ? row[column] : toRelationshipCellValue(row[column], target)
    }
    return applyClientValueTransforms(shownFields, prepared)
  })

  // Sum only explicitly-configured numeric columns, over access-visible values.
  const sums: Record<string, number> = {}
  for (const column of shownSumColumns) {
    sums[column] = rows.reduce((total, row) => {
      const numeric = toNumber(applyClientValueTransforms(relatedListConfig.fields, row)[column])
      return numeric === null ? total : total + numeric
    }, 0)
  }

  const fields: Record<string, SerializableFieldConfig> = {}
  for (const column of shownColumns) {
    fields[column] = columnFieldConfig(column, relatedListConfig)
  }

  // JSON round-trip so only serialisable data crosses to the client component.
  const serializedRows = jsonSafeClone(preparedRows)

  return (
    <RelationshipTableClient
      title={formatFieldName(section.fieldName)}
      relatedUrlKey={relatedUrlKey}
      basePath={basePath}
      columns={shownColumns}
      fields={fields}
      rows={serializedRows}
      count={rows.length}
      total={total}
      unavailable={unavailable}
      sumColumns={shownSumColumns}
      sums={sums}
      removeMode={removeMode}
      relatedListKey={section.relatedListKey}
      backReferenceField={section.backReferenceField}
      parentId={parentId}
      parentListKey={parentListKey}
      serverAction={serverAction}
      fieldName={section.fieldName}
      linkEdge={linkEdge ?? undefined}
      canCreate={createForm !== null}
      createFields={createForm?.fields}
      createRelationshipData={createForm?.relationshipData}
      relatedListTitle={formatListName(section.relatedListKey)}
      editableColumns={editableColumns.filter((column) => !unreadable.has(column))}
    />
  )
}
