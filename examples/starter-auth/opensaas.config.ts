import { config, list } from '@opensaas/stack-core'
import { text, relationship, select, timestamp, integer } from '@opensaas/stack-core/fields'
import { authPlugin } from '@opensaas/stack-auth'
import type { AccessControl } from '@opensaas/stack-core'
import type { Lists } from './.opensaas/lists'
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

// Check if the user owns a note (scopes rows to the signed-in owner)
const isOwner: AccessControl = ({ session }) => {
  if (!session) return false
  return {
    ownerId: { equals: session.userId },
  }
}

/**
 * OpenSaas Configuration with Better-Auth
 */
export default config({
  plugins: [
    authPlugin({
      // Enable email/password authentication
      emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        requireConfirmation: true,
      },

      // Enable password reset
      passwordReset: {
        enabled: true,
      },

      // Configure session fields
      sessionFields: ['userId', 'email', 'name'],

      // Disable rate limiting for E2E tests
      // Set DISABLE_RATE_LIMITING=true in your environment to disable
      rateLimit: {
        enabled: process.env.DISABLE_RATE_LIMITING !== 'true',
      },

      // Extend User list with custom fields
      extendUserList: {
        fields: {
          // Curate the auth-derived `accounts`/`sessions` Relationship tables on
          // the User item view (issue #752). Their default columns come from the
          // Account/Session lists' own curation, which surfaces credential
          // columns (Account's `accessToken`/`refreshToken`/`idToken`, Session's
          // `token`) as table headers by default. Field-level access still
          // governs the VALUES, but the example should not model surfacing token
          // columns at all — so we override the columns to non-sensitive fields
          // and disable ad-hoc row removal (these are better-auth-managed). This
          // re-declares the derived relationship with the same `ref`/`many`, so
          // the generated schema is unchanged; only the item-view UI differs.
          accounts: relationship({
            ref: 'Account.user',
            many: true,
            ui: {
              itemView: {
                columns: ['providerId', 'accountId'],
                removeAction: 'none',
              },
            },
          }),
          sessions: relationship({
            ref: 'Session.user',
            many: true,
            ui: {
              itemView: {
                columns: ['ipAddress', 'userAgent', 'expiresAt'],
                removeAction: 'none',
              },
            },
          }),
          // Add a posts relationship. On the User item view this renders as a
          // read-only Relationship table (issue #734): its columns default to
          // Post's curation minus the `author` back-reference, and the totals
          // footer sums the numeric `viewCount` column.
          posts: relationship({
            ref: 'Post.author',
            many: true,
            ui: {
              itemView: {
                columns: ['title', 'status', 'viewCount'],
                sum: ['viewCount'],
                // Default (non-destructive) row removal: the ✕ disconnects a
                // post from this user (ADR-0018). The post itself survives and
                // still appears on the Post list.
                removeAction: 'disconnect',
              },
            },
          }),
          // A second to-many relationship that opts into destructive removal:
          // notes are owned children, so the ✕ deletes the note (confirmed,
          // gated on Note's delete access) rather than disconnecting it.
          notes: relationship({
            ref: 'Note.owner',
            many: true,
            ui: {
              itemView: {
                columns: ['body'],
                removeAction: 'delete',
              },
            },
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

  lists: {
    // User list is auto-generated by authPlugin, but we can reference it
    Post: list<Lists.Post.TypeInfo>({
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
          // yet on create — the resolveInput hook below assigns the
          // signed-in user as author — so "signed in" is the create-time
          // check; read/update compare the signed-in session against the
          // item's actual author.
          access: {
            read: ({ session, item }) => !!session && session.userId === item!.authorId,
            create: isSignedIn,
            update: ({ session, item }) => !!session && session.userId === item!.authorId,
          },
        }),
        status: select({
          options: [
            { label: 'Draft', value: 'draft', ui: { variant: 'secondary' } },
            { label: 'Published', value: 'published', ui: { variant: 'success' } },
          ],
          defaultValue: 'draft',
          ui: { displayMode: 'segmented-control' },
        }),
        publishedAt: timestamp(),
        // Numeric field summed by the User item view's Relationship-table footer.
        viewCount: integer({ defaultValue: 0 }),
        author: relationship({
          ref: 'User.posts',
          access: {
            read: () => true,
            create: isSignedIn,
            update: isSignedIn,
          },
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
      // Chrome polish opt-ins (issue #735). `navCount` shows an access-scoped
      // record count next to the Post nav item; `avatar` renders the label
      // column (`title`) with a deterministic initials bubble ahead of the
      // emphasized title. The User list is left default (no count, text-only
      // label) so the e2e can contrast opted-in chrome against the default.
      ui: {
        navCount: true,
        avatar: true,
        listView: {
          // Custom Bulk action (issue #736): "Publish" sets the selected posts'
          // status to published. The handler runs each id through the SECURED
          // context (`context.db.post.update`), so `isAuthor` update access
          // still applies per row — a post the signer doesn't own returns null
          // (Silent failure) and is absorbed into the "N of M" count without
          // revealing which rows were denied.
          bulkActions: [
            {
              key: 'publish',
              label: 'Publish',
              handler: async ({ ids, context }) => {
                let published = 0
                for (const id of ids) {
                  const updated = await context.db.post.update({
                    where: { id },
                    data: { status: 'published' },
                  })
                  if (updated) published++
                }
                return { message: `Published ${published} of ${ids.length}` }
              },
            },
          ],
        },
      },
      hooks: {
        // Auto-set publishedAt when status changes to published
        // Auto-set author on create if not provided
        resolveInput: async ({ operation, resolvedData, item, context }) => {
          let data = { ...resolvedData }

          // Auto-set author on create if not provided
          if (operation === 'create' && !data.author && context.session?.userId) {
            data.author = { connect: { id: context.session.userId } }
          }

          // If changing status to published and publishedAt isn't set yet
          if (operation === 'create' && data?.status === 'published') {
            data.publishedAt = new Date()
          } else if (operation === 'update' && data?.status === 'published' && !item?.publishedAt) {
            data.publishedAt = new Date()
          }

          return data
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
      },
    }),

    // A simple owned-child list used to demonstrate destructive row removal on
    // the User item view's `notes` Relationship table (ADR-0018): removing a
    // note there deletes it, because a note only belongs to its owner.
    Note: list<Lists.Note.TypeInfo>({
      fields: {
        body: text({ validation: { isRequired: true }, ui: { displayMode: 'textarea' } }),
        owner: relationship({ ref: 'User.notes' }),
      },
      access: {
        operation: {
          query: isOwner,
          create: isSignedIn,
          update: isOwner,
          delete: isOwner,
        },
      },
      hooks: {
        // Auto-assign the note's owner to the signed-in user on create, so the
        // admin create form only needs the note body.
        resolveInput: async ({ operation, resolvedData, context }) => {
          const data = { ...resolvedData }
          if (operation === 'create' && !data.owner && context.session?.userId) {
            data.owner = { connect: { id: context.session.userId } }
          }
          return data
        },
      },
    }),
  },

  ui: {
    basePath: '/admin',
  },
})
