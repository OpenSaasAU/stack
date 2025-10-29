import { describe, it, expect } from 'vitest'
import { normalizeAuthConfig, authConfig, withAuth } from '../src/config/index.js'
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import type { AuthConfig } from '../src/config/types.js'

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
})

describe('authConfig', () => {
  it('should return the input config unchanged', () => {
    const input: AuthConfig = {
      emailAndPassword: { enabled: true },
      sessionFields: ['userId', 'email'],
    }

    const result = authConfig(input)

    expect(result).toEqual(input)
  })

  it('should work with empty config', () => {
    const result = authConfig({})

    expect(result).toEqual({})
  })
})

describe('withAuth', () => {
  it('should merge auth lists into opensaas config', () => {
    const baseConfig = config({
      db: {
        provider: 'sqlite',
        url: 'file:./test.db',
      },
      lists: {
        Post: list({
          fields: {
            title: text(),
          },
        }),
      },
    })

    const result = withAuth(baseConfig, authConfig({}))

    // Should have both user lists and auth lists
    expect(result.lists).toHaveProperty('Post')
    expect(result.lists).toHaveProperty('User')
    expect(result.lists).toHaveProperty('Session')
    expect(result.lists).toHaveProperty('Account')
    expect(result.lists).toHaveProperty('Verification')
  })

  it('should preserve database config', () => {
    const baseConfig = config({
      db: {
        provider: 'postgresql',
        url: 'postgresql://test',
      },
      lists: {},
    })

    const result = withAuth(baseConfig, authConfig({}))

    expect(result.db.provider).toBe('postgresql')
    expect(result.db.url).toBe('postgresql://test')
  })

  it('should attach normalized auth config internally', () => {
    const baseConfig = config({
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {},
    })

    const result = withAuth(
      baseConfig,
      authConfig({
        emailAndPassword: { enabled: true },
      }),
    ) as typeof baseConfig & { __authConfig?: unknown }

    expect(result.__authConfig).toBeDefined()
    expect(
      (result.__authConfig as { emailAndPassword: { enabled: boolean } }).emailAndPassword.enabled,
    ).toBe(true)
  })

  it('should handle empty lists in base config', () => {
    const baseConfig = config({
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {},
    })

    const result = withAuth(baseConfig, authConfig({}))

    expect(result.lists).toHaveProperty('User')
    expect(result.lists).toHaveProperty('Session')
    expect(result.lists).toHaveProperty('Account')
    expect(result.lists).toHaveProperty('Verification')
  })

  it('should extend User list with custom fields', () => {
    const baseConfig = config({
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {},
    })

    const result = withAuth(
      baseConfig,
      authConfig({
        extendUserList: {
          fields: {
            role: text(),
            company: text(),
          },
        },
      }),
    )

    const userList = result.lists.User
    expect(userList).toBeDefined()
    expect(userList.fields).toHaveProperty('role')
    expect(userList.fields).toHaveProperty('company')
    // Should also have base auth fields
    expect(userList.fields).toHaveProperty('email')
    expect(userList.fields).toHaveProperty('name')
  })
})
