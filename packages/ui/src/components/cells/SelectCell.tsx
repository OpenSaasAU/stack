'use client'

import * as React from 'react'
import type { SelectOptionVariant } from '@opensaas/stack-core/fields'
import { Badge } from '../../primitives/badge.js'
import type { CellComponentProps } from './registry.js'

const NEUTRAL_VARIANT: SelectOptionVariant = 'secondary'

export function SelectCell({ value, field }: CellComponentProps) {
  if (value === null || value === undefined || value === '') {
    return (
      <span data-slot="cell-select" className="text-muted-foreground">
        -
      </span>
    )
  }

  const stringValue = String(value)
  const option = field.options?.find((opt) => opt.value === stringValue)
  const label = option?.label ?? stringValue
  const variant = option?.ui?.variant ?? NEUTRAL_VARIANT

  return (
    <Badge data-slot="cell-select" variant={variant}>
      {label}
    </Badge>
  )
}
