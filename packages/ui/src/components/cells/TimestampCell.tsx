'use client'

import * as React from 'react'
import { parseTimestamp, useFormattedDateTime } from '../../lib/dateFormat.js'
import type { CellComponentProps } from './registry.js'

export function TimestampCell({ value }: CellComponentProps) {
  const date = parseTimestamp(value)
  const text = useFormattedDateTime(date)
  if (text === null) {
    return (
      <span data-slot="cell-timestamp" className="text-muted-foreground">
        -
      </span>
    )
  }
  return <span data-slot="cell-timestamp">{text}</span>
}
