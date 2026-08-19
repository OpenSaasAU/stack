'use client'

import * as React from 'react'
import type { CellComponentProps } from './registry.js'

/**
 * Narrow an unknown value to a valid `Date`, or `null`. Timestamps arrive as
 * ISO strings across the server/client boundary, but epoch numbers and `Date`
 * instances are handled too — no casting.
 */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

export function TimestampCell({ value }: CellComponentProps) {
  const date = toDate(value)
  if (date === null) {
    return (
      <span data-slot="cell-timestamp" className="text-muted-foreground">
        -
      </span>
    )
  }
  return <span data-slot="cell-timestamp">{date.toLocaleString()}</span>
}
