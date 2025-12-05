import type { BaseFieldConfig } from '@opensaas/stack-core'
import type { SearchableOptions, SearchableMetadata } from '../config/types.js'

/**
 * High-level field wrapper that automatically adds embedding field and hooks
 *
 * This wrapper makes it easy to add semantic search to any text field by
 * automatically creating a companion embedding field that stays in sync.
 *
 * @example
 * ```typescript
 * import { text } from '@opensaas/stack-core/fields'
 * import { searchable } from '@opensaas/stack-rag/fields'
 *
 * fields: {
 *   content: searchable(text(), {
 *     provider: 'openai',
 *     dimensions: 1536
 *   })
 * }
 * ```
 *
 * This is equivalent to the manual pattern:
 * ```typescript
 * fields: {
 *   content: text(),
 *   contentEmbedding: embedding({
 *     sourceField: 'content',
 *     provider: 'openai',
 *     dimensions: 1536,
 *     autoGenerate: true
 *   })
 * }
 * ```
 *
 * @param field - The field to make searchable (usually text() or richText())
 * @param options - Embedding configuration options
 * @returns The same field with searchable metadata attached
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Searchable must accept any field config
export function searchable<T extends BaseFieldConfig<any>>(
  field: T,
  options: SearchableOptions = {},
): T & { _searchable: SearchableMetadata } {
  const { embeddingFieldName, provider, dimensions, chunking } = options

  // Attach metadata to the field for ragPlugin to detect
  return {
    ...field,
    _searchable: {
      // Use custom name if provided, otherwise will be set by plugin based on field name
      embeddingFieldName: embeddingFieldName || '',
      provider,
      dimensions,
      chunking,
    },
  }
}
