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

/**
 * Access control helpers
 *
 * The session shape these read is declared in `types/session.d.ts`, which
 * augments `Session` from `@opensaas/stack-core`.
 */

// Check if user is signed in. Typed by its parameter (`Parameters<AccessControl>[0]`)
// rather than as a whole `: AccessControl`, with an explicit `boolean` return: this
// helper is reused for both operation-level access (which accepts a row filter) and
// field-level access (which does not, and never has — field access is a per-field
// visibility decision, not a row filter). Since it never returns a filter, pinning
// the return type to `boolean` keeps it valid at both call sites.
const isSignedIn = ({ session }: Parameters<AccessControl>[0]): boolean => {
  return !!session
}

// Check if user is the author of a post. Scopes ROWS, so it stays `AccessControl`
// (filter-returning) and is used only at the operation level — field-level access
// cannot honour a filter, so the per-field checks below compare `item.authorId`
// directly and return a `boolean`.
const isAuthor: AccessControl = ({ session }) => {
  if (!session) return false
  return {
    authorId: { equals: session.userId },
  }
}

// The per-field counterpart of `isAuthor`. The `!` on `item` is deliberate: the
// admin UI's inline-edit affordance check calls field-level `update` rules without
// an `item` — it is deciding whether to show the affordance per column, not per row
// — and treats a throw there as "potentially writable, let the real per-row check at
// commit time decide".
const isAuthorOfItem = ({ session, item }: Parameters<AccessControl>[0]): boolean => {
  return !!session && session.userId === item!.authorId
}

// Check if user is the owner of their own user record
const isOwner = ({ session, item }: Parameters<AccessControl>[0]): boolean => {
  return !!session && session.userId === item?.id
}

/**
 * OpenSaas Configuration
 */
export default config({
  db: {
    provider: 'postgresql',
    // Auto-timestamps are OFF by default (ADR-0004). This example sorts and
    // reads `createdAt`/`updatedAt`, so opt back in globally.
    timestamps: true,
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
        // Virtual field - computed from name and email, not stored in database.
        // A hook's `item` is exactly its declared dependency set plus the
        // list's system fields (ADR-0051), so the columns it reads have to be
        // named here or they arrive undefined.
        displayName: virtual({
          type: 'string', // TypeScript output type
          needs: ['name', 'email'],
          hooks: {
            resolveOutput: ({ item }) => {
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
          // required to be distinct. Contract: a (non-unique) index on the
          // title column.
          isIndexed: true,
          access: {
            read: () => true,
            create: isSignedIn,
            update: isAuthorOfItem,
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
            update: isAuthorOfItem,
          },
        }),
        internalNotes: text({
          ui: { displayMode: 'textarea' },
          // Only the author can read/write internal notes. There is no `item` yet
          // on create, so "signed in" is the create-time check — the author is
          // whoever is creating the post.
          access: {
            read: isAuthorOfItem,
            create: isSignedIn,
            update: isAuthorOfItem,
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
        // The Post end of the Post↔Tag many-to-many. There is no implicit
        // many-to-many (ADR-0048): the edge is a row of `PostTag`, so this
        // field reads those rows and the Tags table on the item view adds and
        // removes them under `PostTag`'s own access.
        tags: relationship({
          ref: 'PostTag.post',
          many: true,
          ui: { itemView: { columns: ['tag'], removeAction: 'delete' } },
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
              publishedAt: new Date().toISOString(),
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

    Tag: list<Lists.Tag.TypeInfo>({
      fields: {
        name: text({ validation: { isRequired: true }, isIndexed: 'unique' }),
        posts: relationship({
          ref: 'PostTag.tag',
          many: true,
          ui: { itemView: { columns: ['post'], removeAction: 'delete' } },
        }),
      },
      access: {
        operation: {
          query: () => true,
          create: isSignedIn,
          update: isSignedIn,
          delete: isSignedIn,
        },
      },
    }),

    // One edge of the Post↔Tag many-to-many. Adding an edge is a create of
    // this row under THIS list's create access, and removing one is a delete
    // of it — neither is a nested write on Post or Tag, so the access engine
    // sees every edge write (ADR-0050, ADR-0018 as amended).
    PostTag: list<Lists.PostTag.TypeInfo>({
      fields: {
        post: relationship({ ref: 'Post.tags' }),
        tag: relationship({ ref: 'Tag.posts' }),
      },
      db: {
        // A database-level backstop for "one tag per post": two concurrent
        // adds both pass an application-level existence check and both insert.
        indexes: [{ fields: ['post', 'tag'], unique: true }],
      },
      access: {
        operation: {
          query: () => true,
          create: isSignedIn,
          update: isSignedIn,
          delete: isSignedIn,
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
