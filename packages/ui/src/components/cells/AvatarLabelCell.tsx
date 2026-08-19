'use client'

import * as React from 'react'
import { Avatar } from '../../primitives/avatar.js'
import type { CellComponentProps } from './registry.js'

/**
 * The bubble is rendered `decorative` (hidden from the accessibility tree): the
 * emphasized label text beside it already conveys the row's identity, so the
 * cell's accessible name stays exactly the label — not "AL Ada Lovelace" — which
 * keeps table cells addressable by their label and avoids reading the identity
 * twice.
 */
export function AvatarLabelCell({ value }: CellComponentProps) {
  const isEmpty = value === null || value === undefined || value === ''
  const label = isEmpty ? '' : String(value)

  return (
    <span data-slot="cell-avatar-label" className="flex items-center gap-2">
      <Avatar name={label} decorative />
      {isEmpty ? (
        <span className="text-muted-foreground">-</span>
      ) : (
        <span className="font-medium text-foreground">{label}</span>
      )}
    </span>
  )
}
