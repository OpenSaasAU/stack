'use client'

import * as React from 'react'
import { Check, Minus } from 'lucide-react'
import type { CellComponentProps } from './registry.js'

export function CheckboxCell({ value }: CellComponentProps) {
  if (value) {
    return (
      <Check
        data-slot="cell-checkbox"
        role="img"
        aria-label="Yes"
        className="h-4 w-4 text-success"
      />
    )
  }
  return (
    <Minus
      data-slot="cell-checkbox"
      role="img"
      aria-label="No"
      className="h-4 w-4 text-muted-foreground"
    />
  )
}
