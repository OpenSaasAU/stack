import { z } from 'zod'
import type { ContractFieldDescriptor } from '@opensaas/stack-core/extend'
import type { RichTextField } from '../config/types.js'

/**
 * Tiptap's document type, referenced through this package rather than
 * `@tiptap/react`: the generated types are compiled in the consuming app,
 * where `@tiptap/react` is this package's own dependency and not resolvable
 * under a strict node_modules layout.
 */
const JSON_CONTENT = "import('@opensaas/stack-tiptap').JSONContent"

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
export function richText(options?: Omit<RichTextField, 'type'>): RichTextField {
  const isRequired = options?.validation?.isRequired === true
  const face = isRequired ? JSON_CONTENT : `${JSON_CONTENT} | null`

  return {
    type: 'richText',
    outputType: face,
    inputType: face,
    ...options,
    getZodSchema: (fieldName: string, operation: 'create' | 'update') => {
      const validation = options?.validation
      const isRequired = validation?.isRequired

      // Tiptap emits a complex nested JSONContent structure; accept any valid JSON.
      const baseSchema = z.any()

      if (isRequired && operation === 'create') {
        // Reject undefined on create.
        return baseSchema
      } else if (isRequired && operation === 'update') {
        // Allow undefined on update (partial updates).
        return z.union([baseSchema, z.undefined()])
      } else {
        return baseSchema.optional()
      }
    },
    getPrismaType: () => {
      const isRequired = options?.validation?.isRequired

      return {
        type: 'Json',
        modifiers: isRequired ? undefined : '?',
      }
    },
    getContractField: (fieldName: string): ContractFieldDescriptor => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pg', type: 'jsonb' },
      nullable: !isRequired,
    }),
    getTypeScriptType: () => {
      return {
        type: 'any',
        optional: !isRequired,
      }
    },
  }
}
