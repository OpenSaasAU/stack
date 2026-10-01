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

function hasContent(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false
  const { type, text, content } = node as { type?: unknown; text?: unknown; content?: unknown }
  if (typeof text === 'string' && text.trim() !== '') return true
  if (Array.isArray(content) && content.some(hasContent)) return true
  return typeof type === 'string' && type !== 'doc' && type !== 'paragraph' && type !== 'text'
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
        .refine((value) => JSON.stringify(value).length <= MAX_DOCUMENT_LENGTH, {
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
