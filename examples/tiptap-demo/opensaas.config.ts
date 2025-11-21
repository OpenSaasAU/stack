import { config, list } from '@opensaas/stack-core'
import { text, timestamp, relationship } from '@opensaas/stack-core/fields'
import { richText } from '@opensaas/stack-tiptap/fields'
import type { AccessControl } from '@opensaas/stack-core'
import type { User, Article } from '@/.opensaas/types'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

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
 * OpenSaas Configuration with Tiptap Rich Text Editor
 */
export default config({
  db: {
    provider: 'sqlite',
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || './dev.db' })
      return new PrismaClient({ adapter })
    },
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
