'use client'

import * as React from 'react'
import type { CellComponentProps } from './registry.js'

export function TextCell({ value }: CellComponentProps) {
  if (value === null || value === undefined || value === '') {
    return (
      <span data-slot="cell-text" className="text-muted-foreground">
        -
      </span>
    )
  }
  // This is also the fallback for a field type with no registered Cell — a
  // plain object or array stringified with `String()` reads as
  // `[object Object]`, which looks broken rather than merely unsupported. A
  // class instance with its own `toString()` (a `Decimal`, a `Date` — the
  // `virtual()` custom-type pattern in CLAUDE.md) is left alone; it already
  // renders something meaningful.
  if (Array.isArray(value) || (typeof value === 'object' && value.constructor === Object)) {
    return (
      <span data-slot="cell-text" className="text-muted-foreground italic">
        Unsupported value
      </span>
    )
  }
  return <span data-slot="cell-text">{String(value)}</span>
}
