import {
  getItemLabel,
  getUrlKey,
  type OpenSaasConfig,
  type FieldConfig,
  type ListConfig,
} from '@opensaas/stack-core'
import { formatFieldName } from '../lib/utils.js'
import { serializeFieldConfig, type SerializableFieldConfig } from '../lib/serializeFieldConfig.js'
import type { RelationshipTableSection } from '../lib/deriveItemView.js'
import { RelationshipTableClient } from './RelationshipTableClient.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig is generic over TypeInfo
type AnyListConfig = ListConfig<any>

export interface RelationshipTableProps {
  config: OpenSaasConfig
  /** The derived section describing this to-many relationship. */
  section: RelationshipTableSection
  /**
   * The parent record's related rows for this relationship, already fetched and
   * access-filtered through the secured context (`context.db` include). Only
   * access-visible rows/fields are present here.
   */
  rows: Array<Record<string, unknown>>
  basePath: string
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
 * Read-only Relationship table (issue #734) — a section of the item view
 * showing a to-many relationship's related rows. Server Component: it resolves
 * columns, cells (via the shared serialise path), and the totals footer sums
 * from rows already fetched through the secured context, then hands minimal,
 * serialisable props to {@link RelationshipTableClient}.
 *
 * Read-only in this ticket: rows navigate to the related record on click.
 * Inline cell edit (#737), the pre-linked create drawer (#738), and row removal
 * (#739) extend the named Slots left in the client component — no edit/add/
 * remove affordances are rendered here.
 */
export function RelationshipTable({ config, section, rows, basePath }: RelationshipTableProps) {
  const relatedListConfig = config.lists[section.relatedListKey]
  const relatedUrlKey = getUrlKey(section.relatedListKey)

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
      sumColumns={section.sumColumns}
      sums={sums}
    />
  )
}
