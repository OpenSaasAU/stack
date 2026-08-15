import { config, list } from '@opensaas/stack-core'
import {
  text,
  relationship,
  select,
  timestamp,
  calendarDay,
  password,
  virtual,
  checkbox,
  integer,
} from '@opensaas/stack-core/fields'
import type { AccessControl } from '@opensaas/stack-core'
import type { Lists } from '@/.opensaas/lists'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

/**
 * Access control helpers
 */

// Check if user is signed in
//
// Typed as `Parameters<AccessControl>[0]` rather than the whole function as
// `: AccessControl`, and returning `boolean` explicitly: these helpers are
// reused for both operation-level access (which accepts a Prisma filter) and
// field-level access (which does not, and never has — field access is a
// per-field visibility decision, not a row filter). Since none of these
// return a filter, pinning the return type to `boolean` keeps them valid at
// both call sites.
const isSignedIn = ({ session: _session }: Parameters<AccessControl>[0]): boolean => {
  return true
}

// Check if user is the author of a post
const isAuthor = ({ session: _session }: Parameters<AccessControl>[0]): boolean => {
  return true
}

// Check if user is the owner of their own user record
const isOwner = ({ session: _session, item: _item }: Parameters<AccessControl>[0]): boolean => {
  return true
}

/**
 * OpenSaas Configuration
 */
export default config({
  db: {
    provider: 'sqlite',
    // Auto-timestamps are OFF by default (ADR-0004). This example sorts and
    // reads `createdAt`/`updatedAt`, so opt back in globally.
    timestamps: true,
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || './dev.db' })
      return new PrismaClient({ adapter })
    },
  },

  lists: {
    Settings: list<Lists.Settings.TypeInfo>({
      fields: {
        siteName: text({
          validation: { isRequired: true },
          defaultValue: 'My Blog',
        }),
        maintenanceMode: checkbox({
          defaultValue: false,
        }),
        maxUploadSize: integer({
          defaultValue: 10,
        }),
      },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
      isSingleton: true,
    }),

    User: list<Lists.User.TypeInfo>({
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
        // Virtual field - computed from name and email, not stored in database
        displayName: virtual({
          type: 'string', // TypeScript output type
          hooks: {
            resolveOutput: ({ item }) => {
              // item is now typed as User with name, email, etc.
              return `${item.name || 'Unknown'} (${item.email || 'no-email'})`
            },
          },
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

    Post: list<Lists.Post.TypeInfo>({
      fields: {
        title: text({
          validation: { isRequired: true },
          // Non-unique index: titles are looked up and sorted on, but are not
          // required to be distinct. Emitted as `@@index([title])` on the model
          // — Prisma has no field-level `@index` attribute.
          isIndexed: true,
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
        publishDate: calendarDay({
          validation: { isRequired: false },
          db: { map: 'publish_date' },
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
          query: ({ session: _session }) => {
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
        resolveInput: async ({ resolvedData, item }) => {
          // If changing status to published and publishedAt isn't set yet
          if (resolvedData?.status === 'published' && !item?.publishedAt) {
            return {
              ...resolvedData,
              publishedAt: new Date(),
            }
          }
          return { ...resolvedData }
        },
        // Example validation: title must not contain "spam"
        validateInput: async (args) => {
          if (args.operation === 'delete') return
          const { resolvedData, addValidationError } = args
          if (
            resolvedData.title &&
            typeof resolvedData.title === 'string' &&
            resolvedData.title.toLowerCase().includes('spam')
          ) {
            addValidationError('Title cannot contain the word "spam"')
          }
        },
        // Example beforeOperation: log the operation
        beforeOperation: async (args) => {
          if (args.operation === 'create') {
            console.log(`About to ${args.operation} post: new`)
          } else {
            console.log(`About to ${args.operation} post:`, args.item?.id)
          }
        },
        // Example afterOperation: log the result
        afterOperation: async (args) => {
          if (args.operation === 'create' || args.operation === 'update') {
            console.log(`Successfully ${args.operation}d post:`, args.item.id)
          } else if (args.operation === 'delete') {
            console.log(`Successfully deleted post:`, args.originalItem.id)
          }
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
