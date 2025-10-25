/**
 * Example demonstrating type inference in field hooks
 *
 * This file shows how the TItem generic flows from list<T>() down to field hooks
 */

import { list, password, text } from '@opensaas/stack-core'

// Simulated generated Prisma type (would come from .opensaas/types.ts)
type User = {
  id: string
  email: string
  password: string
  name: string | null
  createdAt: Date
  updatedAt: Date
}

// Example 1: With type parameter - full type inference
const userListWithTypes = list<User>({
  fields: {
    email: text({
      validation: { isRequired: true },
    }),
    password: password({
      validation: { isRequired: true },
      hooks: {
        // ✅ TypeScript infers:
        // - inputValue: string | undefined
        // - item: User | undefined
        // - operation: 'create' | 'update'
        resolveInput: async ({ inputValue, item, operation }) => {
          // item.email would be typed as string
          // item.createdAt would be typed as Date
          console.log('User email:', item?.email)
          console.log('Operation:', operation)

          // Example: Don't allow changing password within first 24 hours
          if (operation === 'update' && item) {
            const daysSinceCreation = (Date.now() - item.createdAt.getTime()) / (1000 * 60 * 60 * 24)
            if (daysSinceCreation < 1) {
              throw new Error('Cannot change password within first 24 hours')
            }
          }

          return inputValue
        },
        // ✅ TypeScript infers:
        // - value: string | undefined
        // - item: User
        // - operation: 'query'
        resolveOutput: ({ value, item }) => {
          // item.email would be typed as string
          console.log('Loading password for user:', item.email)
          return value
        },
        // ✅ TypeScript infers void return type (side effects only)
        beforeOperation: async ({ resolvedValue, item, operation }) => {
          // Log password change attempts
          if (operation === 'update' && item) {
            console.log(`Password change attempt for user ${item.email}`)
            // Could send notification, log to audit trail, etc.
          }
        },
      },
    }),
    name: text({
      hooks: {
        resolveInput: async ({ inputValue, item }) => {
          // ✅ item is typed as User | undefined
          // ✅ inputValue is typed as string | undefined

          // Example: Capitalize name on create
          if (inputValue && typeof inputValue === 'string') {
            return inputValue.charAt(0).toUpperCase() + inputValue.slice(1)
          }
          return inputValue
        },
      },
    }),
  },
})

// Example 2: Without type parameter - still works but less specific
const userListWithoutTypes = list({
  fields: {
    email: text({ validation: { isRequired: true } }),
    password: password({
      hooks: {
        // ⚠️ TypeScript infers:
        // - inputValue: string | undefined
        // - item: any
        // - operation: 'create' | 'update'
        resolveInput: async ({ inputValue, item }) => {
          // item is typed as 'any' - no autocomplete or type safety
          console.log(item?.email) // No error, but no type checking
          return inputValue
        },
      },
    }),
  },
})

// Example 3: Custom field with hooks
type Post = {
  id: string
  title: string
  slug: string
  authorId: string
  author: User
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const postList = list<Post>({
  fields: {
    title: text({
      validation: { isRequired: true },
      hooks: {
        resolveInput: async ({ inputValue, item }) => {
          // ✅ item is typed as Post | undefined
          // ✅ Can access item.author.email with full type safety

          if (item?.author) {
            console.log(`Updating post by ${item.author.email}`)
          }

          return inputValue
        },
      },
    }),
    slug: text({
      hooks: {
        resolveInput: async ({ inputValue, item, operation }) => {
          // Auto-generate slug from title on create if not provided
          if (operation === 'create' && !inputValue && item) {
            // ✅ item.title is typed as string with autocomplete
            return item.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
          }
          return inputValue
        },
      },
    }),
  },
})

/**
 * Type inference flow:
 *
 * 1. User calls list<User>({ ... })
 * 2. The list() function signature transforms the config:
 *    - Input: { fields: Record<string, FieldConfig>, ... }
 *    - Output: ListConfig<User> which has FieldsWithItemType<..., User>
 * 3. The FieldsWithItemType mapped type transforms each field:
 *    - password: PasswordField (BaseFieldConfig<string, any>)
 *    - becomes: PasswordField (BaseFieldConfig<string, User>)
 * 4. Field hooks now have proper types:
 *    - FieldHooks<string, User>
 *    - resolveInput({ inputValue: string | undefined, item: User | undefined })
 *    - resolveOutput({ value: string | undefined, item: User })
 *
 * This all happens at the type level - no runtime overhead!
 */

export { userListWithTypes, userListWithoutTypes, postList }
