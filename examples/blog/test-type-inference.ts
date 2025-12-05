import { virtual } from '@opensaas/stack-core/fields'
import { list } from '@opensaas/stack-core'
import type { Lists } from '@/.opensaas/lists'

// Test that virtual field hook receives properly typed item parameter
const testList = list<Lists.User.TypeInfo>({
  fields: {
    displayName: virtual({
      type: 'string', // TypeScript output type
      hooks: {
        resolveOutput: ({ item }) => {
          // This should show the item type as the User model, not 'any'
          // TypeScript should know that item has properties like name, email, etc.
          const name = item.name // Should be typed as string | undefined
          const email = item.email // Should be typed as string | undefined

          return `${name || 'Unknown'} (${email || 'no-email'})`
        },
      },
    }),
  },
})

// Export to avoid unused variable warning
export { testList }
