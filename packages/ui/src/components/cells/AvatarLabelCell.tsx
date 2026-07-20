'use client'

import * as React from 'react'
import { Avatar } from '../../primitives/avatar.js'
import type { CellComponentProps } from './registry.js'

/**
 * Avatar label Cell (issue #735) — the opt-in rendering of a list's label
 * column: an initials {@link Avatar} bubble ahead of the emphasized Item label.
 * Both the initials and the bubble colour derive deterministically from the
 * label value, so a row looks the same everywhere it appears.
 *
 * This Cell is applied to the label column only when the list opts in via
 * `ui.avatar`; a per-field cell override still wins (the caller routes to the
 * override first). An empty label degrades to a neutral bubble plus a muted
 * dash, matching the plain text Cell's empty rendering. Slot:
 * `cell-avatar-label`.
 *
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
