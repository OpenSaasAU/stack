import { config, list } from '@opensaas/stack-core'
import { text, relationship, select, timestamp } from '@opensaas/stack-core/fields'
import { authPlugin } from '@opensaas/stack-auth'
import { mcp } from '@opensaas/stack-auth/plugins'
import type { AccessControl } from '@opensaas/stack-core'
import { z } from 'zod'

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
  return { authorId: { equals: session.userId } }
}

/**
 * OpenSaas Configuration with MCP enabled
 *
 * Uses authPlugin with Better Auth MCP plugin for authentication
 */
export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: true },
      betterAuthPlugins: [mcp({ loginPage: '/sign-in' })],
      extendUserList: {
        fields: {
          posts: relationship({
            ref: 'Post.author',
            many: true,
          }),
        },
      },
    }),
  ],

  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL || 'file:./dev.db',
  },

  // Enable MCP server with Better Auth OAuth
  mcp: {
    enabled: true,
    basePath: '/api/mcp',
    auth: {
      type: 'better-auth',
      loginPage: '/sign-in',
      scopes: ['openid', 'profile', 'email'],
    },
    // Global defaults for all lists
    defaultTools: {
      read: true,
      create: true,
      update: true,
      delete: true,
    },
  },

  lists: {
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
      },
      // MCP configuration for Post list with custom tools
      mcp: {
        tools: {
          read: true,
          create: true,
          update: true,
          delete: true,
        },
        // Add custom MCP tool for publishing posts
        customTools: [
          {
            name: 'publishPost',
            description: 'Publish a draft post and set publishedAt timestamp',
            inputSchema: z.object({
              postId: z.string(),
            }),
            handler: async ({ input, context }) => {
              const post = await context.db.post.update({
                where: { id: input.postId },
                data: {
                  status: 'published',
                  publishedAt: new Date(),
                },
              })

              if (!post) {
                return {
                  error: 'Failed to publish post. Access denied or post not found.',
                }
              }

              return {
                success: true,
                message: `Post "${post.title}" published successfully`,
                post,
              }
            },
          },
          {
            name: 'unpublishPost',
            description: 'Unpublish a post and clear publishedAt timestamp',
            inputSchema: z.object({
              postId: z.string(),
            }),
            handler: async ({ input, context }) => {
              const post = await context.db.post.update({
                where: { id: input.postId },
                data: {
                  status: 'draft',
                  publishedAt: null,
                },
              })

              if (!post) {
                return {
                  error: 'Failed to unpublish post. Access denied or post not found.',
                }
              }

              return {
                success: true,
                message: `Post "${post.title}" unpublished successfully`,
                post,
              }
            },
          },
        ],
      },
    }),
  },

  ui: {
    basePath: '/admin',
  },
})
