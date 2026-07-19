'use client'

import * as React from 'react'
import type { CellComponentProps } from './registry.js'

/**
 * Plain-text Cell — the default rendering for text fields and the fallback for
 * any field type without a registered Cell. Renders a muted dash for
 * empty values. Slot: `cell-text`.
 */
export function TextCell({ value }: CellComponentProps) {
  if (value === null || value === undefined || value === '') {
    return (
      <span data-slot="cell-text" className="text-muted-foreground">
        -
      </span>
    )
  }
  return <span data-slot="cell-text">{String(value)}</span>
}
