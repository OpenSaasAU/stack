import { config, list } from '@opensaas/core'
import { text, timestamp, relationship } from '@opensaas/core/fields'
import { richText } from '@opensaas/tiptap/fields'
import type { AccessControl } from '@opensaas/core'
import type { User, Article } from './prisma/__generated__/prisma-client'

/**
 * Access control helpers
 */

// Check if user is signed in
const isSignedIn: AccessControl = ({ session }) => {
  return !!session
}

// Check if user is the author of an article
const isAuthor: AccessControl = ({ session }) => {
  if (!session) return false
  return {
    authorId: { equals: session.userId },
  }
}

/**
 * OpenSaaS Configuration with Tiptap Rich Text Editor
 */
export default config({
  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL || 'file:./dev.db',
    prismaClientPath: './__generated__/prisma-client',
  },

  lists: {
    User: list<User>({
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
          update: ({ session, item }) => !!session && session.userId === item?.id,
          delete: ({ session, item }) => !!session && session.userId === item?.id,
        },
      },
    }),

    Article: list<Article>({
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
          if (operation === 'create' && !result?.slug && result?.title) {
            const slug = (result.title as string)
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
