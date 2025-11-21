import { config, list } from '@opensaas/stack-core'
import { text, relationship, select, timestamp, password } from '@opensaas/stack-core/fields'
import type { Post, User } from './.opensaas/types'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

/**
 * OpenSaas Configuration
 */
export default config({
  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL || 'file:./dev.db',
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
        password: password({
          validation: { isRequired: true },
        }),
        /**
         * GLOBAL FIELD TYPE EXAMPLE
         * Using the globally registered "color" field type
         * Just specify the type - no need to pass component
         */
        favoriteColor: text({
          ui: {
            fieldType: 'color',
          },
        }),
        posts: relationship({
          ref: 'Post.author',
          many: true,
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
    }),

    Post: list<Post>({
      fields: {
        title: text({
          validation: { isRequired: true },
        }),
        /**
         * CUSTOM SLUG FIELD EXAMPLE
         * Using a globally registered slug field type
         */
        slug: text({
          validation: { isRequired: true },
          isIndexed: 'unique',
          ui: {
            fieldType: 'slug',
          },
        }),
        content: text({
          ui: { displayMode: 'textarea' },
        }),
        /**
         * ANOTHER GLOBAL FIELD TYPE EXAMPLE
         * Using the color picker for theme color
         * Demonstrating reusability of globally registered component
         */
        themeColor: text({
          ui: {
            fieldType: 'color',
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
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
      hooks: {
        resolveInput: async ({ operation, resolvedData, item }) => {
          const result = { ...resolvedData }

          // Auto-set publishedAt when status changes to published
          if (result.status === 'published' && (!item?.publishedAt || operation === 'create')) {
            result.publishedAt = new Date()
          }

          // Auto-generate slug from title if not provided
          if (operation === 'create' && !result.slug && result.title) {
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
      // This is a mock for the example
      // In a real app, this would integrate with your auth system
      // For now, return null (not authenticated)
      return null
    },
  },

  ui: {
    basePath: '/admin',
    /**
     * THEME CONFIGURATION
     * Demonstrates the theming system with custom colors
     */
    theme: {
      preset: 'neon', // Use "neon" preset theme
      // Optional: Override specific colors
      // colors: {
      //   primary: "280 100% 50%", // Custom magenta
      // },
      radius: 0.75, // Rounded corners
    },
  },
})
