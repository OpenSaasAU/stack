import type { ReactNode } from 'react'
import { renderToReactElement } from '@tiptap/static-renderer/pm/react'
import { resolveFeatures, richTextExtensions, type RichTextFeatures } from '../features/features.js'
import { createSanitizer } from './sanitize.js'

export interface RichTextContentProps {
  /** The stored document. Anything that is not a document renders nothing. */
  value: unknown
  /** The field's feature set. Defaults to `defaultRichTextFeatures`. */
  features?: RichTextFeatures
}

/**
 * Renders a stored `richText()` document read-only, as React elements.
 * Nodes, marks and attributes outside `features` are dropped, and link hrefs
 * are re-checked against the field's link policy.
 */
export function RichTextContent({ value, features }: RichTextContentProps): ReactNode {
  const resolved = resolveFeatures(features)
  const document = createSanitizer(resolved)(value)
  if (document === null) return null
  return renderToReactElement({
    content: document,
    extensions: richTextExtensions(resolved, { editor: false }),
  })
}
