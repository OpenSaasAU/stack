import { config, list } from '@opensaas/stack-core'
import { text, relationship, select, timestamp, password } from '@opensaas/stack-core/fields'
import type { AccessControl } from '@opensaas/stack-core'

/**
 * Access control helpers
 */

// Check if user is signed in
const isSignedIn: AccessControl = ({ session }) => {
  return !!session
}

// Check if user is the author of a post
const isAuthor: AccessControl = ({ session }) => {
  if (!session) return false
  return {
    authorId: { equals: session.userId },
  }
}

// Check if user is the owner of their own user record
const isOwner: AccessControl = ({ session, item }) => {
  if (!session) return false
  return session.userId === item?.id
}

/**
 * OpenSaas Configuration
 */
export default config({
  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL || 'file:./dev.db',
  },

  lists: {
    User: list({
      fields: {
        name: text({
          validation: { isRequired: true },
        }),
        email: text({
          validation: { isRequired: true },
          isIndexed: 'unique',
        }),
        password: password({
          validation: { isRequired: true },
        }),
        posts: relationship({
          ref: 'Post.author',
          many: true,
        }),
      },
      access: {
        operation: {
          // Anyone can query users (for displaying author names)
          query: () => true,
          // Anyone can create a user (sign up)
          create: () => true,
          // Only update your own user record
          update: isOwner,
          // Only delete your own user record
          delete: isOwner,
        },
      },
    }),

    Post: list({
      fields: {
        title: text({
          validation: { isRequired: true },
          access: {
            read: () => true,
            create: isSignedIn,
            update: isAuthor,
          },
        }),
        slug: text({
          validation: { isRequired: true },
          isIndexed: 'unique',
        }),
        content: text({
          ui: { displayMode: 'textarea' },
          access: {
            read: () => true,
            create: isSignedIn,
            update: isAuthor,
          },
        }),
        internalNotes: text({
          ui: { displayMode: 'textarea' },
          // Only the author can read/write internal notes
          access: {
            read: isAuthor,
            create: isAuthor,
            update: isAuthor,
          },
        }),
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          defaultValue: 'draft',
          ui: { displayMode: 'segmented-control' },
        }),
        publishedAt: timestamp(),
        author: relationship({
          ref: 'User.posts',
        }),
      },
      access: {
        operation: {
          // Non-authenticated users can only see published posts
          // Authenticated users can see all posts
          query: ({ session }) => {
            if (!session) {
              return { status: { equals: 'published' } }
            }
            return true
          },
          // Must be signed in to create
          create: isSignedIn,
          // Only author can update
          update: isAuthor,
          // Only author can delete
          delete: isAuthor,
        },
      },
      hooks: {
        // Auto-set publishedAt when status changes to published
        resolveInput: async ({ operation, resolvedData, item }) => {
          // If changing status to published and publishedAt isn't set yet
          if (
            resolvedData?.status === 'published' &&
            (!item?.publishedAt || operation === 'create')
          ) {
            return {
              ...resolvedData,
              publishedAt: new Date(),
            }
          }
          return { ...resolvedData }
        },
        // Example validation: title must not contain "spam"
        validateInput: async ({ resolvedData, addValidationError }) => {
          if (
            resolvedData?.title &&
            typeof resolvedData.title === 'string' &&
            resolvedData.title.toLowerCase().includes('spam')
          ) {
            addValidationError('Title cannot contain the word "spam"')
          }
        },
        // Example beforeOperation: log the operation
        beforeOperation: async ({ operation, item }) => {
          console.log(`About to ${operation} post:`, item?.id || 'new')
        },
        // Example afterOperation: log the result
        afterOperation: async ({ operation, item }) => {
          console.log(`Successfully ${operation}d post:`, item?.id)
        },
      },
    }),
  },

  session: {
    getSession: async () => {
      // This is a mock for the example
      // In a real app, this would integrate with your auth system
      // For now, return null (not authenticated)
      return null
    },
  },

  ui: {
    basePath: '/admin',
  },
})
