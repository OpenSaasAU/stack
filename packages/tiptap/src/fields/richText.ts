import { z } from 'zod'
import type { RichTextField } from '../config/types.js'

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
  return {
    type: 'richText',
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
    getTypeScriptType: () => {
      const isRequired = options?.validation?.isRequired

      return {
        type: 'any',
        optional: !isRequired,
      }
    },
  }
}
