'use client'

import * as React from 'react'
import type { CellComponentProps } from './registry.js'

/**
 * Renders a fixed mask for a `password()` column regardless of `value` — a
 * password column must never render the underlying value, so this Cell does
 * not read it at all.
 */
export function PasswordCell(_props: CellComponentProps) {
  return <span data-slot="cell-password">••••••••</span>
}
