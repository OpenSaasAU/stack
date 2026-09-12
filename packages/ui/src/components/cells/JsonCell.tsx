'use client'

import * as React from 'react'
import type { CellComponentProps } from './registry.js'

function describeJsonValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 1 ? '1 item' : `${value.length} items`
  }
  const keys = Object.keys(value as Record<string, unknown>)
  return keys.length === 1 ? '1 key' : `${keys.length} keys`
}

/** A compact shape/size summary — never the raw payload — for a `json()` value. */
export function JsonCell({ value }: CellComponentProps) {
  if (value === null || value === undefined) {
    return (
      <span data-slot="cell-json" className="text-muted-foreground">
        -
      </span>
    )
  }

  if (typeof value !== 'object') {
    return (
      <span data-slot="cell-json" className="text-muted-foreground font-mono text-xs">
        {String(value)}
      </span>
    )
  }

  return (
    <span data-slot="cell-json" className="text-muted-foreground font-mono text-xs">
      {Array.isArray(value) ? 'Array' : 'Object'} ({describeJsonValue(value)})
    </span>
  )
}
