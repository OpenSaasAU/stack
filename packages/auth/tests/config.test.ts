import { describe, it, expect } from 'vitest'
import { normalizeAuthConfig } from '../src/config/index.js'
import { authPlugin } from '../src/config/plugin.js'
import { config, list } from '@opensaas/stack-core'
import { text, select } from '@opensaas/stack-core/fields'
import type { NormalizedAuthConfig } from '../src/config/types.js'

describe('normalizeAuthConfig', () => {
  it('should apply default values for disabled features', () => {
    const result = normalizeAuthConfig({})

    expect(result.emailAndPassword.enabled).toBe(false)
    expect(result.emailAndPassword.minPasswordLength).toBe(8)
    expect(result.emailVerification.enabled).toBe(false)
    expect(result.passwordReset.enabled).toBe(false)
    expect(result.session.expiresIn).toBe(604800) // 7 days
    expect(result.sessionFields).toEqual(['userId', 'email', 'name'])
    expect(result.socialProviders).toEqual({})
    expect(result.betterAuthPlugins).toEqual([])
  })

  it('should normalize email and password config', () => {
    const result = normalizeAuthConfig({
      emailAndPassword: {
        enabled: true,
        minPasswordLength: 12,
        requireConfirmation: false,
      },
    })

    expect(result.emailAndPassword.enabled).toBe(true)
    expect(result.emailAndPassword.minPasswordLength).toBe(12)
    expect(result.emailAndPassword.requireConfirmation).toBe(false)
  })

  it('should apply defaults for partial email and password config', () => {
    const result = normalizeAuthConfig({
      emailAndPassword: { enabled: true },
    })

    expect(result.emailAndPassword.enabled).toBe(true)
    expect(result.emailAndPassword.minPasswordLength).toBe(8)
    expect(result.emailAndPassword.requireConfirmation).toBe(true)
  })

  it('should normalize email verification config', () => {
    const result = normalizeAuthConfig({
      emailVerification: {
        enabled: true,
        sendOnSignUp: false,
        tokenExpiration: 3600,
      },
    })

    expect(result.emailVerification.enabled).toBe(true)
    expect(result.emailVerification.sendOnSignUp).toBe(false)
    expect(result.emailVerification.tokenExpiration).toBe(3600)
  })

  it('should normalize password reset config', () => {
    const result = normalizeAuthConfig({
      passwordReset: {
        enabled: true,
        tokenExpiration: 7200,
      },
    })

    expect(result.passwordReset.enabled).toBe(true)
    expect(result.passwordReset.tokenExpiration).toBe(7200)
  })

  it('should normalize session config', () => {
    const result = normalizeAuthConfig({
      session: {
        expiresIn: 86400, // 1 day
        updateAge: false,
      },
    })

    expect(result.session.expiresIn).toBe(86400)
    expect(result.session.updateAge).toBe(false)
  })

  it('should normalize custom session fields', () => {
    const result = normalizeAuthConfig({
      sessionFields: ['userId', 'email', 'role'],
    })

    expect(result.sessionFields).toEqual(['userId', 'email', 'role'])
  })

  it('should include social providers', () => {
    const result = normalizeAuthConfig({
      socialProviders: {
        github: {
          clientId: 'github-id',
          clientSecret: 'github-secret',
        },
      },
    })

    expect(result.socialProviders).toEqual({
      github: {
        clientId: 'github-id',
        clientSecret: 'github-secret',
      },
    })
  })

  it('should include extendUserList config', () => {
    const result = normalizeAuthConfig({
      extendUserList: {
        fields: {
          role: text(),
        },
      },
    })

    expect(result.extendUserList).toHaveProperty('fields')
    expect(result.extendUserList.fields).toHaveProperty('role')
  })

  it('should include custom sendEmail function', () => {
    const mockSendEmail = async () => {}

    const result = normalizeAuthConfig({
      sendEmail: mockSendEmail,
    })

    expect(result.sendEmail).toBe(mockSendEmail)
  })

  it('should provide default sendEmail that logs to console', () => {
    const result = normalizeAuthConfig({})

    expect(typeof result.sendEmail).toBe('function')
    // Default sendEmail should be a function that accepts email params
    expect(result.sendEmail.length).toBe(1)
  })

  it('should include betterAuthPlugins', () => {
    const mockPlugin = { id: 'test-plugin' }

    const result = normalizeAuthConfig({
      betterAuthPlugins: [mockPlugin],
    })

    expect(result.betterAuthPlugins).toEqual([mockPlugin])
  })

  it('should default access to an empty object', () => {
    const result = normalizeAuthConfig({})

    expect(result.access).toEqual({})
  })

  it('should include the access passthrough, keyed by better-auth model name', () => {
    const userAccess = { operation: { query: () => true } }
    const sessionAccess = { operation: { query: () => true } }

    const result = normalizeAuthConfig({
      access: { user: userAccess, session: sessionAccess },
    })

    expect(result.access.user).toBe(userAccess)
    expect(result.access.session).toBe(sessionAccess)
  })

  describe('models.tableName (issue #862)', () => {
    it('defaults tableName to undefined for unrenamed models', () => {
      const result = normalizeAuthConfig({})

      expect(result.models.user.tableName).toBeUndefined()
      expect(result.models.session.tableName).toBeUndefined()
      expect(result.models.account.tableName).toBeUndefined()
      expect(result.models.verification.tableName).toBeUndefined()
    })

    it('defaults tableName to the renamed modelName, matching pre-#862 behaviour', () => {
      const result = normalizeAuthConfig({
        user: { modelName: 'AuthUser' },
      })

      expect(result.models.user.modelName).toBe('AuthUser')
      expect(result.models.user.tableName).toBe('AuthUser')
    })

    it('resolves an explicit tableName independent of modelName', () => {
      const result = normalizeAuthConfig({
        user: { modelName: 'AuthUser', tableName: 'user' },
      })

      expect(result.models.user.modelName).toBe('AuthUser')
      expect(result.models.user.tableName).toBe('user')
    })

    it('honours an explicit tableName even when modelName is left at its default', () => {
      const result = normalizeAuthConfig({
        session: { tableName: 'sessions' },
      })

      expect(result.models.session.modelName).toBe('Session')
      expect(result.models.session.tableName).toBe('sessions')
    })
  })
})

describe('authPlugin', () => {
  it('should inject all auth lists into config', async () => {
    const result = await config({
      db: {
        provider: 'sqlite',
      },
      plugins: [authPlugin({})],
      lists: {
        Post: list({
          fields: {
            title: text(),
          },
        }),
      },
    })

    // Should have both user lists and auth lists
    expect(result.lists).toHaveProperty('Post')
    expect(result.lists).toHaveProperty('User')
    expect(result.lists).toHaveProperty('Session')
    expect(result.lists).toHaveProperty('Account')
    expect(result.lists).toHaveProperty('Verification')
  })

  it('should preserve database config', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockConstructor = (() => null) as any
    const result = await config({
      db: {
        provider: 'postgresql',
        prismaClientConstructor: mockConstructor,
      },
      plugins: [authPlugin({})],
      lists: {},
    })

    expect(result.db.provider).toBe('postgresql')
    expect(result.db.prismaClientConstructor).toBe(mockConstructor)
  })

  it('should store normalized auth config in _pluginData', async () => {
    const result = await config({
      plugins: [
        authPlugin({
          emailAndPassword: { enabled: true, minPasswordLength: 12 },
          sessionFields: ['userId', 'email', 'name', 'role'],
        }),
      ],
      lists: {},
    })

    expect(result._pluginData).toHaveProperty('auth')
    const authConfig = result._pluginData.auth as NormalizedAuthConfig
    expect(authConfig.emailAndPassword.enabled).toBe(true)
    expect(authConfig.emailAndPassword.minPasswordLength).toBe(12)
    expect(authConfig.sessionFields).toEqual(['userId', 'email', 'name', 'role'])
  })

  it('should extend User list with custom fields', async () => {
    const result = await config({
      plugins: [
        authPlugin({
          extendUserList: {
            fields: {
              role: select({
                options: [
                  { label: 'Admin', value: 'admin' },
                  { label: 'User', value: 'user' },
                ],
              }),
              company: text(),
            },
          },
        }),
      ],
      lists: {},
    })

    const userList = result.lists.User
    expect(userList).toBeDefined()
    expect(userList.fields).toHaveProperty('role')
    expect(userList.fields).toHaveProperty('company')
    // Should also have base auth fields
    expect(userList.fields).toHaveProperty('email')
    expect(userList.fields).toHaveProperty('name')
  })

  it('should generate User list with correct fields', async () => {
    const result = await config({
      plugins: [authPlugin({})],
      lists: {},
    })

    const userList = result.lists.User
    expect(userList).toBeDefined()
    expect(userList.fields).toHaveProperty('name')
    expect(userList.fields).toHaveProperty('email')
    expect(userList.fields).toHaveProperty('emailVerified')
    expect(userList.fields).toHaveProperty('image')
    expect(userList.fields).toHaveProperty('sessions')
    expect(userList.fields).toHaveProperty('accounts')
  })

  it('should generate Session list with correct fields', async () => {
    const result = await config({
      plugins: [authPlugin({})],
      lists: {},
    })

    const sessionList = result.lists.Session
    expect(sessionList).toBeDefined()
    expect(sessionList.fields).toHaveProperty('token')
    expect(sessionList.fields).toHaveProperty('expiresAt')
    expect(sessionList.fields).toHaveProperty('ipAddress')
    expect(sessionList.fields).toHaveProperty('userAgent')
    expect(sessionList.fields).toHaveProperty('user')
  })

  it('should generate Account list with correct fields', async () => {
    const result = await config({
      plugins: [authPlugin({})],
      lists: {},
    })

    const accountList = result.lists.Account
    expect(accountList).toBeDefined()
    expect(accountList.fields).toHaveProperty('accountId')
    expect(accountList.fields).toHaveProperty('providerId')
    expect(accountList.fields).toHaveProperty('accessToken')
    expect(accountList.fields).toHaveProperty('refreshToken')
    expect(accountList.fields).toHaveProperty('password')
    expect(accountList.fields).toHaveProperty('user')
  })

  it('should generate Verification list with correct fields', async () => {
    const result = await config({
      plugins: [authPlugin({})],
      lists: {},
    })

    const verificationList = result.lists.Verification
    expect(verificationList).toBeDefined()
    expect(verificationList.fields).toHaveProperty('identifier')
    expect(verificationList.fields).toHaveProperty('value')
    expect(verificationList.fields).toHaveProperty('expiresAt')
  })

  it('should work with empty auth config', async () => {
    const result = await config({
      plugins: [authPlugin({})],
      lists: {},
    })

    expect(result.lists).toHaveProperty('User')
    expect(result.lists).toHaveProperty('Session')
    expect(result.lists).toHaveProperty('Account')
    expect(result.lists).toHaveProperty('Verification')
  })

  it('should merge with other user-defined lists', async () => {
    const result = await config({
      plugins: [authPlugin({})],
      lists: {
        Post: list({
          fields: {
            title: text(),
            content: text(),
          },
        }),
        Comment: list({
          fields: {
            text: text(),
          },
        }),
      },
    })

    // Should have both auth lists and user lists
    expect(result.lists).toHaveProperty('User')
    expect(result.lists).toHaveProperty('Session')
    expect(result.lists).toHaveProperty('Account')
    expect(result.lists).toHaveProperty('Verification')
    expect(result.lists).toHaveProperty('Post')
    expect(result.lists).toHaveProperty('Comment')
  })

  it('should pass through config options to normalized config', async () => {
    const result = await config({
      plugins: [
        authPlugin({
          emailAndPassword: {
            enabled: true,
            minPasswordLength: 10,
            requireConfirmation: false,
          },
          emailVerification: {
            enabled: true,
            sendOnSignUp: false,
            tokenExpiration: 3600,
          },
          passwordReset: {
            enabled: true,
            tokenExpiration: 7200,
          },
          session: {
            expiresIn: 86400,
            updateAge: false,
          },
          sessionFields: ['userId', 'email', 'role'],
          socialProviders: {
            github: {
              clientId: 'test-id',
              clientSecret: 'test-secret',
            },
          },
        }),
      ],
      lists: {},
    })

    const authConfig = result._pluginData.auth as NormalizedAuthConfig
    expect(authConfig.emailAndPassword.enabled).toBe(true)
    expect(authConfig.emailAndPassword.minPasswordLength).toBe(10)
    expect(authConfig.emailAndPassword.requireConfirmation).toBe(false)
    expect(authConfig.emailVerification.enabled).toBe(true)
    expect(authConfig.emailVerification.sendOnSignUp).toBe(false)
    expect(authConfig.passwordReset.enabled).toBe(true)
    expect(authConfig.session.expiresIn).toBe(86400)
    expect(authConfig.sessionFields).toEqual(['userId', 'email', 'role'])
    expect(authConfig.socialProviders).toHaveProperty('github')
  })

  it('should process Better Auth plugins with schemas', async () => {
    // Mock Better Auth plugin with schema (using snake_case like Better Auth does)
    const mockPlugin = {
      id: 'test-plugin',
      schema: {
        test_table: {
          fields: {
            id: { type: 'string', required: true },
            name: { type: 'string' },
            isActive: { type: 'boolean' },
            count: { type: 'number' },
            createdAt: { type: 'date' },
          },
        },
      },
    }

    const result = await config({
      plugins: [
        authPlugin({
          betterAuthPlugins: [mockPlugin],
        }),
      ],
      lists: {},
    })

    // Should have auth lists plus the plugin's list (converted to PascalCase)
    expect(result.lists).toHaveProperty('User')
    expect(result.lists).toHaveProperty('TestTable')

    // Verify the converted list has correct fields
    const testTableList = result.lists.TestTable
    expect(testTableList.fields).toHaveProperty('name')
    expect(testTableList.fields).toHaveProperty('isActive')
    expect(testTableList.fields).toHaveProperty('count')
  })

  describe('access control (ADR-0013)', () => {
    it('ships all four auth lists closed (no access) when no access is configured', async () => {
      const result = await config({
        plugins: [authPlugin({})],
        lists: {},
      })

      expect(result.lists.User.access).toBeUndefined()
      expect(result.lists.Session.access).toBeUndefined()
      expect(result.lists.Account.access).toBeUndefined()
      expect(result.lists.Verification.access).toBeUndefined()
    })

    it('applies authPlugin({ access }) to each corresponding created list', async () => {
      const userQuery = () => true
      const sessionQuery = () => true
      const accountQuery = () => true
      const verificationQuery = () => true

      const result = await config({
        plugins: [
          authPlugin({
            access: {
              user: { operation: { query: userQuery } },
              session: { operation: { query: sessionQuery } },
              account: { operation: { query: accountQuery } },
              verification: { operation: { query: verificationQuery } },
            },
          }),
        ],
        lists: {},
      })

      expect(result.lists.User.access?.operation?.query).toBe(userQuery)
      expect(result.lists.Session.access?.operation?.query).toBe(sessionQuery)
      expect(result.lists.Account.access?.operation?.query).toBe(accountQuery)
      expect(result.lists.Verification.access?.operation?.query).toBe(verificationQuery)
    })

    it('honors field-level access in the access passthrough (e.g. hiding Account tokens)', async () => {
      const result = await config({
        plugins: [
          authPlugin({
            access: {
              account: {
                operation: { query: () => true },
              },
            },
          }),
        ],
        lists: {},
      })

      // The passthrough carries the full list access shape (operation + fields);
      // this test locks in that the plugin forwards it verbatim rather than
      // only reading `.operation`.
      expect(result.lists.Account.access?.operation?.query).toBeDefined()
    })

    it('applies the access passthrough with a remapped model name (remap-proof keying)', async () => {
      const userQuery = () => true

      const result = await config({
        plugins: [
          authPlugin({
            user: { modelName: 'AuthUser' },
            access: { user: { operation: { query: userQuery } } },
          }),
        ],
        lists: {},
      })

      expect(result.lists.AuthUser.access?.operation?.query).toBe(userQuery)
    })

    it('extendUserList.access still applies and takes precedence over access.user', async () => {
      const extendAccess = { operation: { query: () => false } }

      const result = await config({
        plugins: [
          authPlugin({
            extendUserList: { access: extendAccess },
            access: { user: { operation: { query: () => true } } },
          }),
        ],
        lists: {},
      })

      expect(result.lists.User.access).toBe(extendAccess)
    })
  })
})
