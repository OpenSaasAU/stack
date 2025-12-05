import { list } from '@opensaas/stack-core'
import { text, timestamp, checkbox, relationship } from '@opensaas/stack-core/fields'
import type { ListConfig, FieldConfig } from '@opensaas/stack-core'

/**
 * Configuration for extending the auto-generated User list
 */
export type ExtendUserListConfig = {
  /**
   * Additional fields to add to the User list
   * You can add custom fields beyond the basic better-auth fields
   */
  fields?: Record<string, FieldConfig>
  /**
   * Access control for the User list
   * If not provided, defaults to basic access control (users can update their own records)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  access?: ListConfig<any>['access']
  /**
   * Hooks for the User list
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  hooks?: ListConfig<any>['hooks']
}

/**
 * Create the base User list with better-auth required fields
 * This matches the better-auth user schema
 */
export function createUserList(
  config?: ExtendUserListConfig, // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
): ListConfig<any> {
  return list({
    fields: {
      // Better-auth required fields
      name: text({
        validation: { isRequired: true },
      }),
      email: text({
        validation: { isRequired: true },
        isIndexed: 'unique',
      }),
      emailVerified: checkbox({
        defaultValue: false,
      }),
      image: text(),

      // Relationships to other auth tables
      sessions: relationship({
        ref: 'Session.user',
        many: true,
      }),
      accounts: relationship({
        ref: 'Account.user',
        many: true,
      }),

      // Custom fields from user config
      ...(config?.fields || {}),
    },
    access: config?.access || {
      operation: {
        // Anyone can query users (for displaying names, etc.)
        query: () => true,
        // Anyone can create a user (sign up)
        create: () => true,
        // Only update your own user record
        update: ({ session, item }) => {
          if (!session) return false
          const userId = (session as { userId?: string }).userId
          const itemId = (item as { id?: string })?.id
          return userId === itemId
        },
        // Only delete your own user record
        delete: ({ session, item }) => {
          if (!session) return false
          const userId = (session as { userId?: string }).userId
          const itemId = (item as { id?: string })?.id
          return userId === itemId
        },
      },
    },
    hooks: config?.hooks,
  })
}

/**
 * Create the Session list for better-auth
 * Stores active user sessions
 */
export function createSessionList(): ListConfig<any> { // eslint-disable-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  return list({
    fields: {
      // Session token (stored in cookie, used as primary key)
      token: text({
        validation: { isRequired: true },
        isIndexed: 'unique',
      }),
      // Expiration timestamp
      expiresAt: timestamp(),
      // Optional: IP address for security
      ipAddress: text(),
      // Optional: User agent for security
      userAgent: text(),
      // Relationship to user (userId will be auto-generated)
      user: relationship({
        ref: 'User.sessions',
      }),
    },
    access: {
      operation: {
        // Only the session owner can query their sessions
        query: ({ session }) => {
          if (!session) return false
          const userId = (session as { userId?: string }).userId
          if (!userId) return false
          // Return Prisma filter for nested relationship
          return {
            user: {
              id: { equals: userId },
            },
          } as Record<string, unknown>
        },
        // Better-auth handles session creation
        create: () => true,
        // No manual updates
        update: () => false,
        // Better-auth handles session deletion (logout)
        delete: ({ session, item }) => {
          if (!session) return false
          const userId = (session as { userId?: string }).userId
          const itemUserId = (item as { user?: { id?: string } })?.user?.id
          return userId === itemUserId
        },
      },
    },
  })
}

/**
 * Create the Account list for better-auth
 * Stores OAuth provider accounts and credentials
 */
export function createAccountList(): ListConfig<any> { // eslint-disable-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  return list({
    fields: {
      // Account identifier from provider
      accountId: text({
        validation: { isRequired: true },
      }),
      // Provider identifier (e.g., 'github', 'google', 'credentials')
      providerId: text({
        validation: { isRequired: true },
      }),
      // Relationship to user (userId will be auto-generated)
      user: relationship({
        ref: 'User.accounts',
      }),
      // OAuth tokens
      accessToken: text(),
      refreshToken: text(),
      accessTokenExpiresAt: timestamp(),
      refreshTokenExpiresAt: timestamp(),
      scope: text(),
      idToken: text(),
      // Password hash for credential provider (better-auth stores in account table)
      password: text(),
    },
    access: {
      operation: {
        // Only the account owner can query their accounts
        query: ({ session }) => {
          if (!session) return false
          const userId = (session as { userId?: string }).userId
          if (!userId) return false
          // Return Prisma filter for nested relationship
          return {
            user: {
              id: { equals: userId },
            },
          } as Record<string, unknown>
        },
        // Better-auth handles account creation
        create: () => true,
        // Better-auth handles account updates (token refresh)
        update: ({ session, item }) => {
          if (!session) return false
          const userId = (session as { userId?: string }).userId
          const itemUserId = (item as { user?: { id?: string } })?.user?.id
          return userId === itemUserId
        },
        // Account owner can delete their accounts
        delete: ({ session, item }) => {
          if (!session) return false
          const userId = (session as { userId?: string }).userId
          const itemUserId = (item as { user?: { id?: string } })?.user?.id
          return userId === itemUserId
        },
      },
    },
  })
}

/**
 * Create the Verification list for better-auth
 * Stores email verification tokens, password reset tokens, etc.
 */
export function createVerificationList(): ListConfig<any> { // eslint-disable-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  return list({
    fields: {
      // Identifier (e.g., email address)
      identifier: text({
        validation: { isRequired: true },
      }),
      // Token value
      value: text({
        validation: { isRequired: true },
      }),
      // Expiration timestamp
      expiresAt: timestamp(),
    },
    access: {
      operation: {
        // No public querying (better-auth handles verification internally)
        query: () => false,
        // Better-auth creates verification tokens
        create: () => true,
        // No updates
        update: () => false,
        // Better-auth deletes used/expired tokens
        delete: () => true,
      },
    },
  })
}

/**
 * Get all auth lists required by better-auth
 * This is the main export used by withAuth()
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
export function getAuthLists(userConfig?: ExtendUserListConfig): Record<string, ListConfig<any>> {
  return {
    User: createUserList(userConfig),
    Session: createSessionList(),
    Account: createAccountList(),
    Verification: createVerificationList(),
  }
}
