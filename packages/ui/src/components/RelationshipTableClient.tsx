'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation.js'
import { cn, formatFieldName, isNumericField } from '../lib/utils.js'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '../primitives/table.js'
import { Card } from '../primitives/card.js'
import { CellRenderer } from './cells/CellRenderer.js'
import type { SerializableFieldConfig } from '../lib/serializeFieldConfig.js'

export interface RelationshipTableClientProps {
  /** Section heading (the relationship field name, title-cased). */
  title: string
  /** URL key of the related list, for row-click navigation. */
  relatedUrlKey: string
  /** Admin base path (e.g. `/admin`). */
  basePath: string
  /** Column field names, in order. */
  columns: string[]
  /** Serialised field config per column, driving Cell resolution. */
  fields: Record<string, SerializableFieldConfig>
  /** Serialised, access-filtered related rows (relationship values pre-resolved). */
  rows: Array<Record<string, unknown>>
  /** Total access-visible row count, always shown in the footer. */
  count: number
  /** Columns summed in the footer (explicit opt-in only). */
  sumColumns: string[]
  /** Per-column footer sum, rendered through that column's Cell. */
  sums: Record<string, number>
}

/**
 * Read-only Relationship table (issue #734), client half. Renders related rows
 * as a table whose cells come from the cell registry (`CellRenderer`), so
 * badges/formatting match the related list's own page. Rows navigate to the
 * related record on click; the table renders no edit/add/remove affordances.
 *
 * Named Slots (the reviewed extension seams for the follow-up tickets):
 * - `relationship-table` — the section container.
 * - `relationship-table-toolbar` — header actions region; the pre-linked create
 *   drawer's "+ Add" (#738) mounts here.
 * - `relationship-table-row` — a related row; row removal (#739) adds its
 *   trailing affordance here.
 * - `relationship-table-cell` — a rendered cell; inline cell edit (#737) wraps
 *   the Cell here.
 * - `relationship-table-footer` — the totals footer (count + configured sums).
 */
export function RelationshipTableClient({
  title,
  relatedUrlKey,
  basePath,
  columns,
  fields,
  rows,
  count,
  sumColumns,
  sums,
}: RelationshipTableClientProps) {
  const router = useRouter()
  const sumColumnSet = React.useMemo(() => new Set(sumColumns), [sumColumns])

  const columnFieldType = (column: string): string | undefined => fields[column]?.type

  return (
    <Card data-slot="relationship-table" className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border p-4">
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        {/* Seam: the pre-linked create drawer's "+ Add" control (#738) mounts here. */}
        <div data-slot="relationship-table-toolbar" className="flex items-center gap-2" />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => {
              const numeric = isNumericField(columnFieldType(column))
              return (
                <TableHead key={column} className={cn(numeric && 'text-right')}>
                  {formatFieldName(column)}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                data-slot="relationship-table-empty"
                colSpan={Math.max(columns.length, 1)}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                No related {title.toLowerCase()} yet.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={String(row.id)}
                data-slot="relationship-table-row"
                className="cursor-pointer"
                onClick={() => router.push(`${basePath}/${relatedUrlKey}/${row.id}`)}
              >
                {columns.map((column) => (
                  <TableCell
                    key={column}
                    data-slot="relationship-table-cell"
                    className={cn(isNumericField(columnFieldType(column)) && 'text-right')}
                  >
                    {/* Read-only Cell; inline cell edit (#737) wraps this. */}
                    <CellRenderer
                      value={row[column]}
                      field={fields[column] ?? { type: 'text' }}
                      fieldName={column}
                      basePath={basePath}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>

        <TableFooter>
          <TableRow data-slot="relationship-table-footer">
            {columns.map((column, index) => {
              const numeric = isNumericField(columnFieldType(column))
              const isSummed = sumColumnSet.has(column)
              return (
                <TableCell key={column} className={cn(numeric && 'text-right')}>
                  {index === 0 && (
                    <span className="text-sm text-muted-foreground">
                      {count} {count === 1 ? 'row' : 'rows'}
                    </span>
                  )}
                  {isSummed && (
                    <span className={cn('font-medium', index === 0 && 'ml-2')}>
                      <CellRenderer
                        value={sums[column]}
                        field={fields[column] ?? { type: 'text' }}
                        fieldName={column}
                        basePath={basePath}
                      />
                    </span>
                  )}
                </TableCell>
              )
            })}
          </TableRow>
        </TableFooter>
      </Table>
    </Card>
  )
}
