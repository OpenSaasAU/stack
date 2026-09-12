'use client'

import type { JSONContent } from '@tiptap/react'
import type { CellComponentProps } from '@opensaas/stack-ui'

const EXCERPT_LENGTH = 120

function* textNodes(node: JSONContent): Generator<string> {
  if (node.text) yield node.text
  if (node.content) {
    for (const child of node.content) {
      yield* textNodes(child)
    }
  }
}

/**
 * A generator delegates lazily, so breaking out of the loop below leaves the
 * rest of the document unvisited — a long article's cost stays bounded by
 * the excerpt length, not the document's size.
 */
function excerptOf(doc: JSONContent): string {
  let text = ''
  for (const chunk of textNodes(doc)) {
    text = text ? `${text} ${chunk}` : chunk
    if (text.length >= EXCERPT_LENGTH) break
  }
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text
}

/** A short plain-text excerpt of a `richText()` document — never the raw JSON. */
export function TiptapCell({ value }: CellComponentProps) {
  const text = value && typeof value === 'object' ? excerptOf(value as JSONContent) : ''

  if (!text) {
    return (
      <span data-slot="cell-richtext" className="text-muted-foreground">
        -
      </span>
    )
  }

  return <span data-slot="cell-richtext">{text}</span>
}
