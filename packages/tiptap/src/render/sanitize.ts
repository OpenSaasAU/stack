import type { JSONContent } from '@tiptap/core'
import { isAllowedHref, richTextExtensions, type RichTextFeatures } from '../features/features.js'
import { getSchema } from '@tiptap/core'

const MAX_DEPTH = 100
const CODE_LANGUAGE = /^[a-z0-9+#-]{0,32}$/i
const ORDERED_LIST_TYPES = new Set(['1', 'a', 'A', 'i', 'I'])

type Mark = NonNullable<JSONContent['marks']>[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanMarks(
  marks: unknown,
  markNames: ReadonlySet<string>,
  features: RichTextFeatures,
): Mark[] {
  if (!Array.isArray(marks)) return []
  const kept: Mark[] = []
  for (const mark of marks) {
    if (!isRecord(mark) || typeof mark.type !== 'string' || !markNames.has(mark.type)) continue
    if (mark.type === 'link') {
      const attrs = isRecord(mark.attrs) ? mark.attrs : {}
      const { href } = attrs
      if (typeof href !== 'string' || !isAllowedHref(href, features.link ?? {})) continue
      kept.push({ type: 'link', attrs: { href } })
    } else {
      kept.push({ type: mark.type })
    }
  }
  return kept
}

function cleanAttrs(
  type: string,
  attrs: Record<string, unknown>,
  features: RichTextFeatures,
): Record<string, unknown> | null {
  switch (type) {
    case 'heading': {
      const levels: readonly unknown[] = features.heading?.levels ?? []
      return levels.includes(attrs.level) ? { level: attrs.level } : null
    }
    case 'codeBlock': {
      const { language } = attrs
      return typeof language === 'string' && CODE_LANGUAGE.test(language) ? { language } : {}
    }
    case 'orderedList': {
      const { start, type: listType } = attrs
      const clean: Record<string, unknown> = {}
      if (typeof start === 'number' && Number.isInteger(start) && start > 0) clean.start = start
      if (typeof listType === 'string' && ORDERED_LIST_TYPES.has(listType)) clean.type = listType
      return clean
    }
    default:
      return {}
  }
}

export function createSanitizer(
  features: RichTextFeatures,
): (document: unknown) => JSONContent | null {
  const schema = getSchema(richTextExtensions(features, { editor: false }))
  const nodeNames = new Set(Object.keys(schema.nodes))
  const markNames = new Set(Object.keys(schema.marks))

  function clean(node: unknown, depth: number): JSONContent | null {
    if (depth > MAX_DEPTH || !isRecord(node) || typeof node.type !== 'string') return null
    const { type } = node
    if (!nodeNames.has(type)) return null

    if (type === 'text') {
      if (typeof node.text !== 'string' || node.text === '') return null
      const marks = cleanMarks(node.marks, markNames, features)
      return marks.length > 0 ? { type, text: node.text, marks } : { type, text: node.text }
    }

    const attrs = cleanAttrs(type, isRecord(node.attrs) ? node.attrs : {}, features)
    if (attrs === null) return null

    const result: JSONContent = { type }
    if (Object.keys(attrs).length > 0) result.attrs = attrs
    if (Array.isArray(node.content)) {
      const content: JSONContent[] = []
      for (const child of node.content) {
        const kept = clean(child, depth + 1)
        if (kept !== null) content.push(kept)
      }
      if (content.length > 0) result.content = content
    }
    return result
  }

  return (document) => {
    const root = clean(document, 1)
    return root !== null && root.type === 'doc' ? root : null
  }
}
