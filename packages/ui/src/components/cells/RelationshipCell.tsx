'use client'

import * as React from 'react'
import Link from 'next/link.js'
import { getUrlKey } from '@opensaas/stack-core'
import type { CellComponentProps, CellValue } from './registry.js'

/**
 * One related row's `{ id, label }`. The label is normally resolved server-side
 * via the shared label seam (`getItemLabel`); the fallback here covers callers
 * that pass unresolved rows.
 */
interface RelatedRef {
  id: string | null
  label: string
}

/**
 * A related-row object is never an array. Narrowing through this (rather than
 * an `as` cast) is what makes deleting the `value === null` check below a type
 * error: `object` excludes `null`, but `typeof null === 'object'` means a
 * caller who forgets that check still has `null` in `value`'s type here, and
 * this function's parameter type refuses it.
 */
function isRelatedRowShape(value: object): value is Record<string, unknown> {
  return !Array.isArray(value)
}

function toRelatedRef(value: CellValue): RelatedRef | null {
  if (value === null || value === undefined || typeof value !== 'object') return null
  if (!isRelatedRowShape(value)) return null
  const id = value.id != null ? String(value.id) : null
  let label: string | undefined
  if (typeof value.label === 'string') label = value.label
  else if (typeof value.name === 'string') label = value.name
  else if (typeof value.title === 'string') label = value.title
  else if (id !== null) label = id
  if (label === undefined) return null
  return { id, label }
}

function EmptyDash() {
  return <span className="text-muted-foreground">-</span>
}

/**
 * Relationship Cell (issue #732). To-many renders the related COUNT — resolved
 * server-side by the secured read's own count reducer, so it only ever counts
 * rows the session may see; an array of refs is tolerated as a fallback (its
 * length is the count). To-one renders the related row's Item label, linked to
 * its edit page when the field's `ref` resolves a URL.
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
