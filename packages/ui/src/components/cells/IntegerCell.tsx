'use client'

import * as React from 'react'
import { cn } from '../../lib/utils.js'
import type { CellComponentProps } from './registry.js'

// Right alignment is applied by the table cell (the numeric column), not here.
export function IntegerCell({ value }: CellComponentProps) {
  if (value === null || value === undefined) {
    return (
      <span data-slot="cell-integer" className="tabular-nums text-muted-foreground">
        -
      </span>
    )
  }
  return (
    <span data-slot="cell-integer" className={cn('tabular-nums')}>
      {String(value)}
    </span>
  )
}
