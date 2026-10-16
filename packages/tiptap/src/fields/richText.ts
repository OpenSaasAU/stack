import { z } from 'zod'
import { formatFieldName } from '@opensaas/stack-core/extend'
import type { ContractFieldDescriptor, FieldKeys, TypeInfo } from '@opensaas/stack-core/extend'
import type { RichTextField } from '../config/types.js'

/**
 * Tiptap's document type, referenced through this package rather than
 * `@tiptap/react`: the generated types are compiled in the consuming app,
 * where `@tiptap/react` is this package's own dependency and not resolvable
 * under a strict node_modules layout.
 */
const JSON_CONTENT = "import('@opensaas/stack-tiptap').JSONContent"

const MAX_DOCUMENT_LENGTH = 1_000_000

const MAX_DOCUMENT_DEPTH = 100

const TEXT_CONTAINERS = new Set([
  'doc',
  'text',
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
])

function isWithinSizeCap(value: unknown): boolean {
  try {
    return JSON.stringify(value).length <= MAX_DOCUMENT_LENGTH
  } catch {
    return false
  }
}

function childNodes(node: unknown): unknown[] {
  if (typeof node !== 'object' || node === null) return []
  const { content } = node as { content?: unknown }
  return Array.isArray(content) ? content : []
}

function isWithinDepthCap(root: unknown): boolean {
  const pending: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 1 }]
  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    if (entry.depth > MAX_DOCUMENT_DEPTH) return false
    for (const child of childNodes(entry.node)) {
      pending.push({ node: child, depth: entry.depth + 1 })
    }
  }
  return true
}

function hasContent(root: unknown): boolean {
  const pending: unknown[] = [root]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (typeof node !== 'object' || node === null) continue
    const { type, text } = node as { type?: unknown; text?: unknown }
    if (typeof text === 'string' && text.trim() !== '') return true
    if (typeof type === 'string' && !TEXT_CONTAINERS.has(type)) return true
    pending.push(...childNodes(node))
  }
  return false
}

/**
 * Rich text field using Tiptap editor
 * Stores content as JSON in the database
 *
 * @example
 * ```ts
 * import { richText } from '@opensaas/stack-tiptap/fields'
 *
 * fields: {
 *   content: richText({
 *     validation: { isRequired: true },
 *     ui: {
 *       placeholder: "Write your content here...",
 *       minHeight: 200
 *     }
 *   })
 * }
 * ```
 */
export function richText<
  TTypeInfo extends TypeInfo = TypeInfo,
  TKey extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
>(options?: Omit<RichTextField<TTypeInfo, TKey>, 'type'>): RichTextField<TTypeInfo, TKey> {
  const isRequired = options?.validation?.isRequired === true
  const face = isRequired ? JSON_CONTENT : `${JSON_CONTENT} | null`

  return {
    type: 'richText',
    outputType: face,
    inputType: face,
    ...options,
    getZodSchema: (fieldName: string, operation: 'create' | 'update') => {
      const message = `${formatFieldName(fieldName)} is required`
      const document = z
        .object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() })
        .passthrough()
        .refine(isWithinDepthCap, {
          message: `${formatFieldName(fieldName)} is nested too deeply`,
        })
        .refine(isWithinSizeCap, {
          message: `${formatFieldName(fieldName)} is too large`,
        })

      if (!isRequired) return document.nullable().optional()

      const required = z
        .any()
        .refine((value) => value !== undefined && value !== null, { message })
        .pipe(document.refine(hasContent, { message }))
      return operation === 'create' ? required : required.optional()
    },
    getContractField: (fieldName: string): ContractFieldDescriptor => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pg', type: 'jsonb' },
      nullable: !isRequired,
    }),
  }
}
