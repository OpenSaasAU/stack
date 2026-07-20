'use client'

import * as React from 'react'
import Link from 'next/link.js'
import { getUrlKey } from '@opensaas/stack-core'
import type { CellComponentProps } from './registry.js'

/**
 * One related row's `{ id, label }`. The label is normally resolved server-side
 * via the shared label seam (`getItemLabel`); the raw-record fallback
 * (`name` → `title` → `label` → `id`) covers callers that pass unresolved rows.
 */
interface RelatedRef {
  id: string | null
  label: string
}

function toRelatedRef(value: unknown): RelatedRef | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = 'id' in row && row.id != null ? String(row.id) : null
  let label: string | undefined
  if (typeof row.label === 'string') label = row.label
  else if (typeof row.name === 'string') label = row.name
  else if (typeof row.title === 'string') label = row.title
  else if (id !== null) label = id
  if (label === undefined) return null
  return { id, label }
}

function EmptyDash() {
  return <span className="text-muted-foreground">-</span>
}

/**
 * Relationship Cell (issue #732):
 *
 * - **To-many** (`field.many`) renders the access-visible related COUNT — a
 *   right-aligned tabular number the list view resolves via the secured query's
 *   filtered `_count`, so it only ever counts rows the session may see. Slot:
 *   `cell-relationship-count`.
 * - **To-one** renders the related row's Item label, linked to its edit page
 *   when the field's `ref` (and `basePath`) resolve a URL. Slot:
 *   `cell-relationship`.
 *
 * A to-many value is normally the resolved count (a number); an array of
 * resolved refs is tolerated as a fallback (its length is the count).
 */
export function RelationshipCell({ value, field, basePath = '/admin' }: CellComponentProps) {
  if (field.many === true) {
    const count = typeof value === 'number' ? value : Array.isArray(value) ? value.length : 0
    return (
      <span data-slot="cell-relationship-count" className="tabular-nums">
        {count}
      </span>
    )
  }

  const relatedUrlKey = field.ref ? getUrlKey(field.ref.split('.')[0] ?? '') : undefined

  const renderRef = (ref: RelatedRef, key: React.Key) => {
    if (relatedUrlKey && ref.id !== null) {
      return (
        <Link
          key={key}
          href={`${basePath}/${relatedUrlKey}/${ref.id}`}
          className="text-primary hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {ref.label}
        </Link>
      )
    }
    return <React.Fragment key={key}>{ref.label}</React.Fragment>
  }

  if (Array.isArray(value)) {
    const refs = value.map(toRelatedRef).filter((ref): ref is RelatedRef => ref !== null)
    if (refs.length === 0) return <EmptyDash />
    return (
      <span data-slot="cell-relationship" className="flex flex-wrap gap-1">
        {refs.map((ref, index) => (
          <React.Fragment key={ref.id ?? index}>
            {index > 0 && <span className="text-muted-foreground">, </span>}
            {renderRef(ref, ref.id ?? index)}
          </React.Fragment>
        ))}
      </span>
    )
  }

  const ref = toRelatedRef(value)
  if (ref === null) return <EmptyDash />
  return <span data-slot="cell-relationship">{renderRef(ref, ref.id ?? 'single')}</span>
}
