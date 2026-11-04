import type { ReactNode } from 'react'
import { renderToReactElement } from '@tiptap/static-renderer/pm/react'
import { resolveFeatures, richTextExtensions, type RichTextFeatures } from '../features/features.js'
import { createSanitizer } from './sanitize.js'

type Prepared = {
  sanitize: ReturnType<typeof createSanitizer>
  extensions: ReturnType<typeof richTextExtensions>
}

const prepared = new WeakMap<RichTextFeatures, Prepared>()

function prepare(features: RichTextFeatures): Prepared {
  let entry = prepared.get(features)
  if (entry === undefined) {
    entry = {
      sanitize: createSanitizer(features),
      extensions: richTextExtensions(features, { editor: false }),
    }
    prepared.set(features, entry)
  }
  return entry
}

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
  const { sanitize, extensions } = prepare(resolved)
  const document = sanitize(value)
  if (document === null) return null
  return renderToReactElement({
    content: document,
    extensions,
  })
}
