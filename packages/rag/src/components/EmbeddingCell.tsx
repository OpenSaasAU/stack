'use client'

import type { CellComponentProps } from '@opensaas/stack-ui'
import { redactEmbeddingForClient } from '../fields/embedding-display.js'

/**
 * List-table rendering of an embedding — its size, never its contents. An
 * embedding column is out of the default column set, so this renders only for
 * a table that named the field explicitly.
 */
export function EmbeddingCell({ value }: CellComponentProps) {
  const { isSet, dimensions } = redactEmbeddingForClient(value, {
    showVector: false,
    showMetadata: false,
  })

  if (!isSet) return <span className="text-muted-foreground">-</span>
  return (
    <span>{dimensions === null ? 'Embedded' : `${dimensions.toLocaleString()}-dim vector`}</span>
  )
}
