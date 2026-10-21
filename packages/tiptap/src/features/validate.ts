import { getSchema } from '@tiptap/core'
import { Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model'
import { LINK_REL, isAllowedHref, richTextExtensions, type RichTextFeatures } from './features.js'

const KNOWN_NAMES = new Set([
  'doc',
  'text',
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  'image',
  'table',
  'bold',
  'italic',
  'strike',
  'underline',
  'code',
  'link',
  'highlight',
  'subscript',
  'superscript',
])

const CODE_LANGUAGE = /^[a-z0-9+#-]{0,32}$/i
const ORDERED_LIST_TYPES = new Set(['1', 'a', 'A', 'i', 'I'])

type Attrs = Record<string, unknown>

function describe(name: unknown): string {
  return typeof name === 'string' && KNOWN_NAMES.has(name) ? name : 'unknown'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function attrsOf(node: Record<string, unknown>): Attrs | null {
  const { attrs } = node
  if (attrs === undefined || attrs === null) return {}
  return isRecord(attrs) ? attrs : null
}

function unexpectedKeys(attrs: Attrs, allowed: readonly string[]): boolean {
  return Object.keys(attrs).some((key) => !allowed.includes(key))
}

function checkNodeAttrs(
  type: string,
  attrs: Attrs,
  features: RichTextFeatures,
): string | undefined {
  const label = `Content has a disallowed attribute on a ${type} node`
  switch (type) {
    case 'heading': {
      if (unexpectedKeys(attrs, ['level'])) return label
      const levels: readonly unknown[] = features.heading?.levels ?? []
      return 'level' in attrs && !levels.includes(attrs.level)
        ? 'Content has a heading with a disallowed level'
        : undefined
    }
    case 'codeBlock': {
      if (unexpectedKeys(attrs, ['language'])) return label
      const { language } = attrs
      return language === undefined ||
        language === null ||
        (typeof language === 'string' && CODE_LANGUAGE.test(language))
        ? undefined
        : 'Content has a code block with a disallowed language'
    }
    case 'orderedList': {
      if (unexpectedKeys(attrs, ['start', 'type'])) return label
      const { start, type: listType } = attrs
      if (
        start !== undefined &&
        !(typeof start === 'number' && Number.isInteger(start) && start > 0)
      )
        return 'Content has an ordered list with a disallowed start'
      if (listType !== undefined && listType !== null && !ORDERED_LIST_TYPES.has(String(listType)))
        return 'Content has an ordered list with a disallowed type'
      return undefined
    }
    default:
      return Object.keys(attrs).length > 0 ? label : undefined
  }
}

function checkLinkAttrs(attrs: Attrs, features: RichTextFeatures): string | undefined {
  if (unexpectedKeys(attrs, ['href', 'target', 'rel', 'class', 'title']))
    return 'Content has a disallowed attribute on a link mark'
  const { href, target, rel, class: className, title } = attrs
  if (typeof href !== 'string' || !isAllowedHref(href, features.link ?? {}))
    return 'Content has a link with a disallowed protocol'
  if (target !== undefined && target !== null && target !== '_blank')
    return 'Content has a link with a disallowed target'
  if (rel !== undefined && rel !== null && rel !== LINK_REL)
    return 'Content has a link with a disallowed rel'
  if (className !== undefined && className !== null)
    return 'Content has a link with a disallowed class'
  if (title !== undefined && title !== null) return 'Content has a link with a disallowed title'
  return undefined
}

function findOffence(
  root: unknown,
  schema: Schema,
  features: RichTextFeatures,
): string | undefined {
  const pending: unknown[] = [root]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (!isRecord(node)) return 'Content contains a malformed node'
    const { type, marks, content } = node
    if (typeof type !== 'string' || !Object.hasOwn(schema.nodes, type))
      return `Content contains a disallowed ${describe(type)} node`

    const attrs = attrsOf(node)
    if (attrs === null) return `Content has a malformed attribute set on a ${type} node`
    const problem = checkNodeAttrs(type, attrs, features)
    if (problem !== undefined) return problem

    if (marks !== undefined) {
      if (!Array.isArray(marks)) return 'Content contains a malformed mark'
      for (const mark of marks) {
        if (!isRecord(mark)) return 'Content contains a malformed mark'
        const markType = mark.type
        if (typeof markType !== 'string' || !Object.hasOwn(schema.marks, markType))
          return `Content contains a disallowed ${describe(markType)} mark`
        const markAttrs = attrsOf(mark)
        if (markAttrs === null) return `Content has a malformed attribute set on a ${markType} mark`
        if (markType === 'link') {
          const linkProblem = checkLinkAttrs(markAttrs, features)
          if (linkProblem !== undefined) return linkProblem
        } else if (Object.keys(markAttrs).length > 0) {
          return `Content has a disallowed attribute on a ${markType} mark`
        }
      }
    }

    if (Array.isArray(content)) pending.push(...content)
  }
  return undefined
}

export type FeatureCheck = (document: unknown) => string | undefined

/**
 * Returns the first reason a document breaks the feature set, or `undefined`.
 * Callers must have capped depth first: this recurses into ProseMirror.
 */
export function createFeatureCheck(features: RichTextFeatures): FeatureCheck {
  const schema = getSchema(richTextExtensions(features, { editor: false }))
  return (document) => {
    const offence = findOffence(document, schema, features)
    if (offence !== undefined) return offence
    const { content } = document as { content?: unknown }
    if (!Array.isArray(content) || content.length === 0) return undefined
    try {
      ProseMirrorNode.fromJSON(schema, document).check()
    } catch {
      return 'Content has a structure this field does not allow'
    }
    return undefined
  }
}
