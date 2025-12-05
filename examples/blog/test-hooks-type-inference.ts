import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import type { Lists } from './.opensaas/lists'

/**
 * Type test: Verify list-level hooks receive properly typed parameters
 *
 * This test ensures the Hooks type parameter fix is working correctly.
 * If types are wrong, TypeScript will show errors on the assignments below.
 */
const testHooksTypeInference = list<Lists.Post.TypeInfo>({
  fields: {
    title: text(),
    content: text(),
  },
  hooks: {
    // Test 1: resolveInput should receive typed create/update inputs
    resolveInput: async ({ operation, resolvedData }) => {
      if (operation === 'create') {
        // TypeScript should know these are Post create input fields
        // The types should be inferred from Prisma input types
        const _title: string | undefined = resolvedData.title
        const _content: string | null | undefined = resolvedData.content
      }

      if (operation === 'update') {
        // Update input should also be properly typed
        // Note: Update inputs can be values OR Prisma update operations
        const title = resolvedData.title
        if (title && typeof title === 'string') {
          // Can safely use string methods when narrowed
          console.log(title.length)
        }
      }

      return resolvedData
    },

    // Test 2: validateInput should receive typed data
    validateInput: async ({ operation, resolvedData, addValidationError }) => {
      // Should know resolvedData has Post fields
      if (resolvedData) {
        const title = resolvedData.title
        if (title && typeof title === 'string' && title.length < 3) {
          addValidationError('Title must be at least 3 characters')
        }
      }
    },

    // Test 3: beforeOperation should receive typed item
    beforeOperation: async ({ operation, item, resolvedData }) => {
      if (operation === 'update' && item) {
        // item should be typed as Post with all fields
        const _existingTitle: string = item.title
        const _existingContent: string | null = item.content
        const _id: string = item.id
        const _createdAt: Date = item.createdAt
      }

      if (operation === 'create' && !item) {
        // Item is undefined on create
        console.log('Creating new post')
      }
    },

    // Test 4: afterOperation should receive typed item
    afterOperation: async ({ operation, item }) => {
      // item should exist in afterOperation for most operations
      if (item) {
        const _title: string = item.title
        const _content: string | null = item.content
        const _id: string = item.id

        // Can access all Post fields
        console.log(`Operation ${operation} completed on post: ${item.title}`)
      }
    },
  },
})

export { testHooksTypeInference }
