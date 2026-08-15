import { config, list } from '@opensaas/stack-core'
import { text, relationship, select, timestamp, password } from '@opensaas/stack-core/fields'
import type { AccessControl } from '@opensaas/stack-core'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
/**
 * Access control helpers
 */

// Check if user is signed in. Typed by its parameter (`Parameters<AccessControl>[0]`)
// rather than as a whole `: AccessControl`, with an explicit `boolean` return: this
// helper is reused for both operation-level access (list-level `create`) and
// field-level access (per-field `create`), and only the former accepts a Prisma
// filter — field access is a per-field visibility decision, not a row filter. Since
// this helper never returns a filter, pinning its return type to `boolean` keeps it
// valid at both call sites.
const isSignedIn = ({ session }: Parameters<AccessControl>[0]): boolean => {
  return !!session
}

// Check if user is the author of a post. Scopes ROWS, so it stays `AccessControl`
// (filter-returning) and is used only at the operation level below — field-level
// access cannot honour a filter, see the per-field `access` checks on Post's fields,
// which compare `item.authorId` directly and return a `boolean`.
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
    // Auto-timestamps are OFF by default (ADR-0004). This dashboard sorts and
    // displays `createdAt`/`updatedAt`, so opt back in globally.
    timestamps: true,
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || './dev.db' })
      return new PrismaClient({ adapter })
    },
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
            // Field-level access is a boolean-only visibility check (it cannot
            // scope rows like `isAuthor`'s filter does at the operation level
            // above), so this compares `item.authorId` directly. The `!` is
            // deliberate: the admin UI's inline-edit affordance check calls
            // field-level `update` rules without an `item` (it's deciding
            // whether to show the affordance per column, not per row) and
            // treats a throw there as "potentially writable, let the real
            // per-row check at commit time decide" — dereferencing `item`
            // un-guarded is what makes that fallback trigger correctly.
            update: ({ session, item }) => !!session && session.userId === item!.authorId,
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
            update: ({ session, item }) => !!session && session.userId === item!.authorId,
          },
        }),
        internalNotes: text({
          ui: { displayMode: 'textarea' },
          // Only the author can read/write internal notes. There's no `item`
          // yet on create, so "signed in" is the create-time check — the
          // author is the person creating the post; read/update compare the
          // signed-in session against the item's actual author.
          access: {
            read: ({ session, item }) => !!session && session.userId === item!.authorId,
            create: isSignedIn,
            update: ({ session, item }) => !!session && session.userId === item!.authorId,
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
