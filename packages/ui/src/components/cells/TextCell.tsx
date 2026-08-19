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
  return <span data-slot="cell-text">{String(value)}</span>
}
