'use client'

import type { JSONContent } from '@tiptap/react'
import type { CellComponentProps } from '@opensaas/stack-ui'

const EXCERPT_LENGTH = 120

function extractText(node: JSONContent): string {
  const own = node.text ?? ''
  const children = node.content?.map(extractText).join(' ') ?? ''
  return [own, children].filter(Boolean).join(' ')
}

/** A short plain-text excerpt of a `richText()` document — never the raw JSON. */
export function TiptapCell({ value }: CellComponentProps) {
  const text = value && typeof value === 'object' ? extractText(value as JSONContent).trim() : ''

  if (!text) {
    return (
      <span data-slot="cell-richtext" className="text-muted-foreground">
        -
      </span>
    )
  }

  const excerpt = text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text
  return <span data-slot="cell-richtext">{excerpt}</span>
}
