import { config, list } from '@opensaas/stack-core'
import { text, relationship, select, timestamp } from '@opensaas/stack-core/fields'
import { authPlugin } from '@opensaas/stack-auth'
import { mcp } from '@opensaas/stack-auth/plugins'
import type { AccessControl } from '@opensaas/stack-core'
import { z } from 'zod'
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

      // The User list ships closed by default (ADR-0013) — grant access
      // explicitly. Signed-in users can browse the directory; only the
      // account owner can update or delete their own record.
      access: {
        user: {
          operation: {
            query: isSignedIn,
            update: ({ session, item }) => session?.userId === item.id,
            delete: ({ session, item }) => session?.userId === item.id,
          },
        },
      },
    }),
  ],

  db: {
    provider: 'sqlite',
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || './dev.db' })
      return new PrismaClient({ adapter })
    },
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
        resolveInput: async ({ resolvedData, item }) => {
          if (resolvedData?.status === 'published' && !item?.publishedAt) {
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
