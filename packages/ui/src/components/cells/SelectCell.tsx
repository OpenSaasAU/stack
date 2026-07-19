'use client'

import * as React from 'react'
import type { SelectOptionVariant } from '@opensaas/stack-core/fields'
import { Badge } from '../../primitives/badge.js'
import type { CellComponentProps } from './registry.js'

/**
 * Neutral badge variant used when an option carries no `ui.variant` metadata.
 * State stays scannable even before a project colours its options.
 */
const NEUTRAL_VARIANT: SelectOptionVariant = 'secondary'

/**
 * Select Cell — renders a value as a coloured status Badge. The colour comes
 * from the matched option's additive `ui.variant` metadata (issue #729);
 * unmapped options (and unknown values) fall back to the neutral badge. The
 * option's `label` is shown, matching the field's read-mode rendering. Slot:
 * `cell-select`.
 */
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
