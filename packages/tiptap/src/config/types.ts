import type { BaseFieldConfig } from '@opensaas/stack-core'

/**
 * Rich text field configuration using Tiptap editor
 * Stores content as JSON in the database
 */
export type RichTextField = BaseFieldConfig & {
  type: 'richText'
  validation?: {
    isRequired?: boolean
  }
  ui?: {
    /**
     * Placeholder text for empty editor
     */
    placeholder?: string
    /**
     * Minimum height for editor in pixels
     */
    minHeight?: number
    /**
     * Maximum height for editor in pixels
     */
    maxHeight?: number
    /**
     * Custom React component to render this field
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component?: any
    /**
     * Custom field type name to use from the global registry
     */
    fieldType?: string
  }
}
