import { config, list } from '@opensaas/stack-core'
import { text, timestamp, relationship } from '@opensaas/stack-core/fields'
import { richText } from '@opensaas/stack-tiptap/fields'
import type { AccessControl } from '@opensaas/stack-core'
import type { Lists } from '@/.opensaas/lists'

/**
 * Access control helpers
 *
 * This example wires no authentication, so `getSession` below always returns
 * `null` and these open up. The shape is what a real app writes — a boolean
 * for "may they do this at all", a `where` filter for "which rows" — with the
 * session check left in a comment beside each. See `examples/starter-auth`
 * for the same helpers against a real session.
 */

// Check if user is signed in — `!!session` once auth is wired.
const isSignedIn: AccessControl = ({ session: _session }): boolean => {
  return true
}

// Check if user is the author of an article — with a session, this returns the
// row filter `{ authorId: { equals: session.userId } }` instead.
const isAuthor: AccessControl = ({ session: _session }): boolean => {
  return true
}

// Check if user is the owner of their own user record —
// `session.userId === item?.id` once auth is wired.
const isOwner: AccessControl = ({ session: _session, item: _item }): boolean => {
  return true
}

/**
 * OpenSaas Configuration with Tiptap Rich Text Editor
 */
export default config({
  db: {
    provider: 'postgresql',
  },

  lists: {
    User: list<Lists.User.TypeInfo>({
      fields: {
        name: text({
          validation: { isRequired: true },
        }),
        email: text({
          validation: { isRequired: true },
          isIndexed: 'unique',
        }),
        articles: relationship({
          ref: 'Article.author',
          many: true,
        }),
      },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: isOwner,
          delete: isOwner,
        },
      },
    }),

    Article: list<Lists.Article.TypeInfo>({
      fields: {
        title: text({
          validation: { isRequired: true },
        }),
        slug: text({
          validation: { isRequired: true },
          isIndexed: 'unique',
        }),
        /**
         * Rich text content field using Tiptap
         * Stored as JSON in the database
         */
        content: richText({
          validation: { isRequired: true },
          ui: {
            placeholder: 'Write your article content here...',
            minHeight: 300,
            maxHeight: 800,
          },
        }),
        /**
         * Optional excerpt with rich text
         */
        excerpt: richText({
          ui: {
            placeholder: 'Write a brief excerpt...',
            minHeight: 150,
          },
        }),
        publishedAt: timestamp(),
        author: relationship({
          ref: 'User.articles',
        }),
      },
      access: {
        operation: {
          query: () => true,
          create: isSignedIn,
          update: isAuthor,
          delete: isAuthor,
        },
      },
      hooks: {
        resolveInput: async ({ operation, resolvedData }) => {
          let result = { ...resolvedData }

          // Auto-generate slug from title if not provided
          if (operation === 'create' && !result?.slug && typeof result?.title === 'string') {
            const slug = result.title
              .toLowerCase()
              .replace(/[^\w\s-]/g, '')
              .replace(/\s+/g, '-')
              .replace(/--+/g, '-')
              .trim()
            result.slug = slug
          }

          return result
        },
      },
    }),
  },

  session: {
    getSession: async () => {
      // Mock session for demo
      return null
    },
  },

  ui: {
    basePath: '/admin',
    theme: {
      preset: 'modern',
    },
  },
})
