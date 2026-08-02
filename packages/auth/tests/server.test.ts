import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BetterAuthOptions } from 'better-auth'
import type { NormalizedAuthConfig } from '../src/config/types.js'
import type { OpenSaasConfig, AccessContext } from '@opensaas/stack-core'

const betterAuthMock = vi.fn(() => ({ api: { getSession: vi.fn(async () => null) } }))
const prismaAdapterMock = vi.fn((client: unknown, opts: unknown) => ({ client, opts }))
const nextCookiesMock = vi.fn(() => ({ id: 'next-cookies' }))

vi.mock('better-auth', () => ({
  betterAuth: betterAuthMock,
}))

vi.mock('better-auth/adapters/prisma', () => ({
  prismaAdapter: prismaAdapterMock,
}))

vi.mock('better-auth/next-js', () => ({
  nextCookies: nextCookiesMock,
}))

const { createAuth, getSessionFromAuth } = await import('../src/server/index.js')

function makeAuthConfig(overrides: Partial<NormalizedAuthConfig> = {}): NormalizedAuthConfig {
  return {
    emailAndPassword: { enabled: true, minPasswordLength: 8, requireConfirmation: true },
    emailVerification: { enabled: false, sendOnSignUp: true, tokenExpiration: 86400 },
    passwordReset: { enabled: false, tokenExpiration: 3600 },
    socialProviders: {},
    session: { expiresIn: 604800, updateAge: 86400 },
    models: {
      user: { modelName: 'User', fields: {} },
      session: { modelName: 'Session', fields: {} },
      account: { modelName: 'Account', fields: {} },
      verification: { modelName: 'Verification', fields: {} },
    },
    sessionFields: ['userId', 'email', 'name'],
    extendUserList: {},
    access: {},
    sendEmail: vi.fn(async () => {}),
    betterAuthPlugins: [],
    rateLimit: undefined,
    ...overrides,
  }
}

function makeOpensaasConfig(authConfig: NormalizedAuthConfig): OpenSaasConfig {
  return {
    db: { provider: 'sqlite' },
    lists: {},
    _pluginData: { auth: authConfig },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal test fixture
  } as any
}

function makeContext(): AccessContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal test fixture
  return { prisma: { __mockPrisma: true } } as any
}

async function buildBetterAuthConfig(authConfig: NormalizedAuthConfig): Promise<BetterAuthOptions> {
  const auth = createAuth(makeOpensaasConfig(authConfig), makeContext())
  // Calling a nested method is what actually forces the lazy proxy to resolve
  // the underlying betterAuth() instance — merely accessing `auth.api` does not.
  await auth.api.getSession({})
  expect(betterAuthMock).toHaveBeenCalledTimes(1)
  return betterAuthMock.mock.calls[0][0] as BetterAuthOptions
}

describe('createAuth', () => {
  beforeEach(() => {
    betterAuthMock.mockClear()
    prismaAdapterMock.mockClear()
    nextCookiesMock.mockClear()
  })

  it('forwards emailAndPassword.minPasswordLength', async () => {
    const config = await buildBetterAuthConfig(
      makeAuthConfig({
        emailAndPassword: { enabled: true, minPasswordLength: 12, requireConfirmation: true },
      }),
    )

    expect(config.emailAndPassword).toMatchObject({ enabled: true, minPasswordLength: 12 })
  })

  it('omits emailAndPassword entirely when disabled', async () => {
    const config = await buildBetterAuthConfig(
      makeAuthConfig({
        emailAndPassword: { enabled: false, minPasswordLength: 8, requireConfirmation: true },
      }),
    )

    expect(config.emailAndPassword).toBeUndefined()
  })

  it('forwards emailVerification.sendOnSignUp and tokenExpiration when enabled', async () => {
    const config = await buildBetterAuthConfig(
      makeAuthConfig({
        emailVerification: { enabled: true, sendOnSignUp: false, tokenExpiration: 1234 },
      }),
    )

    expect(config.emailVerification).toBeDefined()
    expect(config.emailVerification?.sendOnSignUp).toBe(false)
    expect(config.emailVerification?.expiresIn).toBe(1234)
    expect(typeof config.emailVerification?.sendVerificationEmail).toBe('function')
  })

  it('omits emailVerification entirely when disabled', async () => {
    const config = await buildBetterAuthConfig(
      makeAuthConfig({
        emailVerification: { enabled: false, sendOnSignUp: true, tokenExpiration: 86400 },
      }),
    )

    expect(config.emailVerification).toBeUndefined()
  })

  it('wires sendVerificationEmail through to the configured sendEmail callback', async () => {
    const sendEmail = vi.fn(async () => {})
    await buildBetterAuthConfig(
      makeAuthConfig({
        emailVerification: { enabled: true, sendOnSignUp: true, tokenExpiration: 86400 },
        sendEmail,
      }),
    )

    const config = betterAuthMock.mock.calls[0][0] as BetterAuthOptions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising the callback shape
    await (config.emailVerification as any).sendVerificationEmail({
      user: { email: 'a@b.com' },
      url: 'http://example.com/verify',
    })

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@b.com',
        subject: 'Verify your email address',
      }),
    )
  })

  it('forwards passwordReset.tokenExpiration and wires sendResetPassword when enabled', async () => {
    const sendEmail = vi.fn(async () => {})
    await buildBetterAuthConfig(
      makeAuthConfig({
        passwordReset: { enabled: true, tokenExpiration: 4321 },
        sendEmail,
      }),
    )

    const config = betterAuthMock.mock.calls[0][0] as BetterAuthOptions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow test-only access
    const emailAndPassword = config.emailAndPassword as any
    expect(emailAndPassword.resetPasswordTokenExpiresIn).toBe(4321)
    expect(typeof emailAndPassword.sendResetPassword).toBe('function')

    await emailAndPassword.sendResetPassword({
      user: { email: 'reset@example.com' },
      url: 'http://example.com/reset',
    })

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'reset@example.com', subject: 'Reset your password' }),
    )
  })

  it('does not add sendResetPassword when passwordReset is disabled', async () => {
    const config = await buildBetterAuthConfig(
      makeAuthConfig({ passwordReset: { enabled: false, tokenExpiration: 3600 } }),
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow test-only access
    const emailAndPassword = config.emailAndPassword as any
    expect(emailAndPassword.sendResetPassword).toBeUndefined()
    expect(emailAndPassword.resetPasswordTokenExpiresIn).toBeUndefined()
  })

  it('passes session.updateAge through as a number', async () => {
    const config = await buildBetterAuthConfig(
      makeAuthConfig({ session: { expiresIn: 604800, updateAge: 3600 } }),
    )

    expect(config.session?.updateAge).toBe(3600)
  })

  it('sets disableSessionRefresh instead of updateAge: 0 when updateAge is false', async () => {
    const config = await buildBetterAuthConfig(
      makeAuthConfig({ session: { expiresIn: 604800, updateAge: false } }),
    )

    // better-auth treats `updateAge: 0` as "refresh on every request", not
    // "never refresh" — disabling refresh requires the separate flag.
    expect(config.session?.disableSessionRefresh).toBe(true)
    expect(config.session?.updateAge).toBeUndefined()
  })

  it('warns when requireConfirmation is set to false since it has no server-side effect', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await buildBetterAuthConfig(
      makeAuthConfig({
        emailAndPassword: { enabled: true, minPasswordLength: 8, requireConfirmation: false },
      }),
    )

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('requireConfirmation'))
    warnSpy.mockRestore()
  })

  it('does not warn when requireConfirmation is left at its default (true)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await buildBetterAuthConfig(
      makeAuthConfig({
        emailAndPassword: { enabled: true, minPasswordLength: 8, requireConfirmation: true },
      }),
    )

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('does not warn about requireConfirmation when emailAndPassword is disabled', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await buildBetterAuthConfig(
      makeAuthConfig({
        emailAndPassword: { enabled: false, minPasswordLength: 8, requireConfirmation: false },
      }),
    )

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('requireConfirmation'))
    warnSpy.mockRestore()
  })

  it('warns when passwordReset is enabled but emailAndPassword is disabled', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await buildBetterAuthConfig(
      makeAuthConfig({
        emailAndPassword: { enabled: false, minPasswordLength: 8, requireConfirmation: true },
        passwordReset: { enabled: true, tokenExpiration: 3600 },
      }),
    )

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('passwordReset'))
    warnSpy.mockRestore()
  })

  it('does not warn about passwordReset when emailAndPassword is enabled', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await buildBetterAuthConfig(
      makeAuthConfig({
        emailAndPassword: { enabled: true, minPasswordLength: 8, requireConfirmation: true },
        passwordReset: { enabled: true, tokenExpiration: 3600 },
      }),
    )

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('passwordReset'))
    warnSpy.mockRestore()
  })
})

describe('getSessionFromAuth', () => {
  it('passes the caller-supplied headers to auth.api.getSession', async () => {
    const headers = new Headers({ cookie: 'session=abc' })
    const getSession = vi.fn(async () => ({ user: { id: 'user-1', email: 'a@b.com' } }))
    const auth = { api: { getSession } } as unknown as Parameters<typeof getSessionFromAuth>[0]

    const result = await getSessionFromAuth(auth, ['userId', 'email'], headers)

    expect(getSession).toHaveBeenCalledWith({ headers })
    expect(result).toEqual({ userId: 'user-1', email: 'a@b.com' })
  })

  it('returns null when there is no session', async () => {
    const getSession = vi.fn(async () => null)
    const auth = { api: { getSession } } as unknown as Parameters<typeof getSessionFromAuth>[0]

    const result = await getSessionFromAuth(auth, ['userId'], new Headers())

    expect(result).toBeNull()
  })

  it('returns null when auth.api.getSession throws', async () => {
    const getSession = vi.fn(async () => {
      throw new Error('boom')
    })
    const auth = { api: { getSession } } as unknown as Parameters<typeof getSessionFromAuth>[0]

    const result = await getSessionFromAuth(auth, ['userId'], new Headers())

    expect(result).toBeNull()
  })
})
