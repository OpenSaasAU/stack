import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

const { createAuth, buildBetterAuthOptions, getSessionFromAuth } =
  await import('../src/server/index.js')

function makeAuthConfig(overrides: Partial<NormalizedAuthConfig> = {}): NormalizedAuthConfig {
  return {
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireConfirmation: true,
      sendResetPassword: vi.fn(async () => {}),
    },
    emailVerification: {
      enabled: false,
      sendOnSignUp: true,
      tokenExpiration: 86400,
      sendVerificationEmail: vi.fn(async () => {}),
    },
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
    betterAuthPlugins: [],
    rateLimit: undefined,
    betterAuthOptions: {},
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
  return { ormHandle: { __mockPrisma: true } } as any
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
        emailAndPassword: {
          enabled: true,
          minPasswordLength: 12,
          requireConfirmation: true,
          sendResetPassword: vi.fn(async () => {}),
        },
      }),
    )

    expect(config.emailAndPassword).toMatchObject({ enabled: true, minPasswordLength: 12 })
  })

  it('omits emailAndPassword entirely when disabled', async () => {
    const config = await buildBetterAuthConfig(
      makeAuthConfig({
        emailAndPassword: {
          enabled: false,
          minPasswordLength: 8,
          requireConfirmation: true,
          sendResetPassword: vi.fn(async () => {}),
        },
      }),
    )

    expect(config.emailAndPassword).toBeUndefined()
  })

  it('forwards emailVerification.sendOnSignUp and tokenExpiration when enabled', async () => {
    const config = await buildBetterAuthConfig(
      makeAuthConfig({
        emailVerification: {
          enabled: true,
          sendOnSignUp: false,
          tokenExpiration: 1234,
          sendVerificationEmail: vi.fn(async () => {}),
        },
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
        emailVerification: {
          enabled: false,
          sendOnSignUp: true,
          tokenExpiration: 86400,
          sendVerificationEmail: vi.fn(async () => {}),
        },
      }),
    )

    expect(config.emailVerification).toBeUndefined()
  })

  it('forwards the configured sendVerificationEmail callback straight through, unwrapped', async () => {
    const sendVerificationEmail = vi.fn(async () => {})
    const config = await buildBetterAuthConfig(
      makeAuthConfig({
        emailVerification: {
          enabled: true,
          sendOnSignUp: true,
          tokenExpiration: 86400,
          sendVerificationEmail,
        },
      }),
    )

    expect(config.emailVerification?.sendVerificationEmail).toBe(sendVerificationEmail)
  })

  it('forwards passwordReset.tokenExpiration and the configured sendResetPassword callback straight through, unwrapped', async () => {
    const sendResetPassword = vi.fn(async () => {})
    const config = await buildBetterAuthConfig(
      makeAuthConfig({
        passwordReset: { enabled: true, tokenExpiration: 4321 },
        emailAndPassword: {
          enabled: true,
          minPasswordLength: 8,
          requireConfirmation: true,
          sendResetPassword,
        },
      }),
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow test-only access
    const emailAndPassword = config.emailAndPassword as any
    expect(emailAndPassword.resetPasswordTokenExpiresIn).toBe(4321)
    expect(emailAndPassword.sendResetPassword).toBe(sendResetPassword)
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
        emailAndPassword: {
          enabled: true,
          minPasswordLength: 8,
          requireConfirmation: false,
          sendResetPassword: vi.fn(async () => {}),
        },
      }),
    )

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('requireConfirmation'))
    warnSpy.mockRestore()
  })

  it('does not warn when requireConfirmation is left at its default (true)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await buildBetterAuthConfig(
      makeAuthConfig({
        emailAndPassword: {
          enabled: true,
          minPasswordLength: 8,
          requireConfirmation: true,
          sendResetPassword: vi.fn(async () => {}),
        },
      }),
    )

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('does not warn about requireConfirmation when emailAndPassword is disabled', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await buildBetterAuthConfig(
      makeAuthConfig({
        emailAndPassword: {
          enabled: false,
          minPasswordLength: 8,
          requireConfirmation: false,
          sendResetPassword: vi.fn(async () => {}),
        },
      }),
    )

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('requireConfirmation'))
    warnSpy.mockRestore()
  })

  it('warns when passwordReset is enabled but emailAndPassword is disabled', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await buildBetterAuthConfig(
      makeAuthConfig({
        emailAndPassword: {
          enabled: false,
          minPasswordLength: 8,
          requireConfirmation: true,
          sendResetPassword: vi.fn(async () => {}),
        },
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
        emailAndPassword: {
          enabled: true,
          minPasswordLength: 8,
          requireConfirmation: true,
          sendResetPassword: vi.fn(async () => {}),
        },
        passwordReset: { enabled: true, tokenExpiration: 3600 },
      }),
    )

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('passwordReset'))
    warnSpy.mockRestore()
  })
})

describe('betterAuthOptions passthrough', () => {
  beforeEach(() => {
    betterAuthMock.mockClear()
    prismaAdapterMock.mockClear()
    nextCookiesMock.mockClear()
  })

  it('produces byte-for-byte identical options to today when unused', async () => {
    // `normalizeAuthConfig` is what actually defaults a config without
    // `betterAuthOptions` to `{}` (see config.test.ts) — reproduce that
    // realistic normalized shape here rather than an AuthConfig missing a
    // required NormalizedAuthConfig field.
    const authConfig = makeAuthConfig({ betterAuthOptions: {} })

    const built = await buildBetterAuthConfig(authConfig)

    expect(built).toEqual({
      database: { client: { __mockPrisma: true }, opts: { provider: 'sqlite' } },
      user: { modelName: 'User' },
      session: { modelName: 'Session', expiresIn: 604800, updateAge: 86400 },
      account: { modelName: 'Account' },
      verification: { modelName: 'Verification' },
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
        minPasswordLength: 8,
      },
      emailVerification: undefined,
      trustedOrigins: [],
      socialProviders: {},
      rateLimit: undefined,
      plugins: [{ id: 'next-cookies' }],
    })
  })

  it('surfaces a top-level option the stack does not model (e.g. baseURL)', async () => {
    const config = await buildBetterAuthConfig(
      makeAuthConfig({ betterAuthOptions: { baseURL: 'https://example.com' } }),
    )

    expect(config.baseURL).toBe('https://example.com')
  })

  it('merges a nested database hook without clobbering sibling top-level keys', async () => {
    const after = vi.fn()
    const config = await buildBetterAuthConfig(
      makeAuthConfig({
        session: { expiresIn: 604800, updateAge: 86400 },
        betterAuthOptions: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only shape
          databaseHooks: { user: { create: { after } } } as any,
        },
      }),
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow test-only access
    expect((config as any).databaseHooks.user.create.after).toBe(after)
    // The stack's own session config survives — passthrough added a sibling
    // top-level key, it didn't replace the whole options object.
    expect(config.session?.expiresIn).toBe(604800)
  })

  it('merges a nested session option without clobbering the stack-set session keys', async () => {
    const config = await buildBetterAuthConfig(
      makeAuthConfig({
        session: { expiresIn: 604800, updateAge: 3600 },
        betterAuthOptions: {
          session: { cookieCache: { enabled: true, maxAge: 300 } },
        },
      }),
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow test-only access
    expect((config.session as any).cookieCache).toEqual({ enabled: true, maxAge: 300 })
    expect(config.session?.expiresIn).toBe(604800)
    expect(config.session?.updateAge).toBe(3600)
  })

  it('lets the passthrough win on a genuine key collision', async () => {
    const config = await buildBetterAuthConfig(
      makeAuthConfig({
        session: { expiresIn: 604800, updateAge: 3600 },
        betterAuthOptions: {
          session: { expiresIn: 999 },
        },
      }),
    )

    expect(config.session?.expiresIn).toBe(999)
  })

  it('replaces an array outright instead of concatenating (e.g. trustedOrigins)', async () => {
    process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'https://env-origin.com'
    try {
      const config = await buildBetterAuthConfig(
        makeAuthConfig({
          betterAuthOptions: { trustedOrigins: ['https://config-origin.com'] },
        }),
      )

      expect(config.trustedOrigins).toEqual(['https://config-origin.com'])
    } finally {
      delete process.env.BETTER_AUTH_TRUSTED_ORIGINS
    }
  })

  it('rejects betterAuthOptions.database', async () => {
    await expect(
      buildBetterAuthOptions(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only shape
        makeOpensaasConfig(makeAuthConfig({ betterAuthOptions: { database: {} as any } })),
        makeContext(),
      ),
    ).rejects.toThrow(/betterAuthOptions\.database/)
  })

  it('rejects betterAuthOptions.plugins', async () => {
    await expect(
      buildBetterAuthOptions(
        makeOpensaasConfig(makeAuthConfig({ betterAuthOptions: { plugins: [] } })),
        makeContext(),
      ),
    ).rejects.toThrow(/betterAuthOptions\.plugins/)
  })

  it.each(['user', 'session', 'account', 'verification'] as const)(
    'rejects betterAuthOptions.%s.additionalFields',
    async (model) => {
      await expect(
        buildBetterAuthOptions(
          makeOpensaasConfig(
            makeAuthConfig({
              betterAuthOptions: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only shape
                [model]: { additionalFields: { foo: { type: 'string' } } } as any,
              },
            }),
          ),
          makeContext(),
        ),
      ).rejects.toThrow(new RegExp(`betterAuthOptions\\.${model}\\.additionalFields`))
    },
  )

  it('does not reject additionalFields nested under an unrelated model key', async () => {
    // A plain object at `user` with no `additionalFields` key must not trip the guard.
    const config = await buildBetterAuthConfig(
      makeAuthConfig({ betterAuthOptions: { user: { modelName: 'CustomUser' } } }),
    )

    expect(config.user).toMatchObject({ modelName: 'CustomUser' })
  })

  it('rejects betterAuthOptions.rateLimit.storage', async () => {
    await expect(
      buildBetterAuthOptions(
        makeOpensaasConfig(
          makeAuthConfig({ betterAuthOptions: { rateLimit: { storage: 'database' } } }),
        ),
        makeContext(),
      ),
    ).rejects.toThrow(/betterAuthOptions\.rateLimit\.storage/)
  })

  it('does not reject other betterAuthOptions.rateLimit keys (customRules/customStorage) and merges them', async () => {
    const customRules = { '/sign-in/email': { window: 10, max: 3 } }
    const config = await buildBetterAuthConfig(
      makeAuthConfig({
        rateLimit: { enabled: true, window: 60, max: 100 },
        betterAuthOptions: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only shape
          rateLimit: { customRules } as any,
        },
      }),
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow test-only access
    const rateLimit = config.rateLimit as any
    expect(rateLimit.customRules).toBe(customRules)
    // The stack's own enabled/window/max survive the merge alongside customRules.
    expect(rateLimit.enabled).toBe(true)
    expect(rateLimit.window).toBe(60)
    expect(rateLimit.max).toBe(100)
  })
})

describe('rateLimit option forwarding (issue #909)', () => {
  beforeEach(() => {
    betterAuthMock.mockClear()
    prismaAdapterMock.mockClear()
    nextCookiesMock.mockClear()
  })

  it('forwards enabled/window/max with no storage key when rateLimit.storage is unset', async () => {
    const config = await buildBetterAuthConfig(
      makeAuthConfig({ rateLimit: { enabled: true, window: 60, max: 100 } }),
    )

    expect(config.rateLimit).toEqual({ enabled: true, window: 60, max: 100 })
  })

  it('forwards storage: "database" alongside enabled/window/max', async () => {
    const config = await buildBetterAuthConfig(
      makeAuthConfig({
        rateLimit: { enabled: true, window: 60, max: 100, storage: 'database' },
        models: {
          user: { modelName: 'User', fields: {} },
          session: { modelName: 'Session', fields: {} },
          account: { modelName: 'Account', fields: {} },
          verification: { modelName: 'Verification', fields: {} },
          rateLimit: { modelName: 'RateLimit', fields: {} },
        },
      }),
    )

    expect(config.rateLimit).toMatchObject({
      enabled: true,
      window: 60,
      max: 100,
      storage: 'database',
      modelName: 'RateLimit',
    })
  })

  it('forwards a custom rateLimit modelName/fields to better-auth so the running instance matches the derived table', async () => {
    const config = await buildBetterAuthConfig(
      makeAuthConfig({
        rateLimit: { enabled: true, storage: 'database' },
        models: {
          user: { modelName: 'User', fields: {} },
          session: { modelName: 'Session', fields: {} },
          account: { modelName: 'Account', fields: {} },
          verification: { modelName: 'Verification', fields: {} },
          rateLimit: { modelName: 'AuthRateLimit', fields: { key: 'limit_key' } },
        },
      }),
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow test-only access
    const rateLimit = config.rateLimit as any
    expect(rateLimit.modelName).toBe('AuthRateLimit')
    expect(rateLimit.fields).toEqual({ key: 'limit_key' })
  })

  it('does not forward modelName/fields when no rateLimit model was derived (storage unset)', async () => {
    const config = await buildBetterAuthConfig(makeAuthConfig({ rateLimit: { enabled: true } }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow test-only access
    const rateLimit = config.rateLimit as any
    expect(rateLimit.modelName).toBeUndefined()
    expect(rateLimit.fields).toBeUndefined()
  })
})

describe('buildBetterAuthOptions / createAuth parity', () => {
  beforeEach(() => {
    betterAuthMock.mockClear()
  })

  it('createAuth constructs betterAuth with exactly what buildBetterAuthOptions returns', async () => {
    const authConfig = makeAuthConfig({
      betterAuthOptions: { baseURL: 'https://example.com' },
    })
    const opensaasConfig = makeOpensaasConfig(authConfig)
    const context = makeContext()

    const built = await buildBetterAuthOptions(opensaasConfig, context)

    const auth = createAuth(opensaasConfig, context)
    await auth.api.getSession({})

    expect(betterAuthMock).toHaveBeenCalledTimes(1)
    expect(betterAuthMock.mock.calls[0][0]).toEqual(built)
  })

  it('createAuth with a plugin tuple constructs betterAuth with exactly what buildBetterAuthOptions returns for the same tuple', async () => {
    const pluginA = { id: 'plugin-a' }
    const authConfig = makeAuthConfig({ betterAuthPlugins: [pluginA] })
    const opensaasConfig = makeOpensaasConfig(authConfig)
    const context = makeContext()

    const built = await buildBetterAuthOptions(opensaasConfig, context, [pluginA])

    const auth = createAuth(opensaasConfig, context, [pluginA])
    await auth.api.getSession({})

    expect(betterAuthMock).toHaveBeenCalledTimes(1)
    expect(betterAuthMock.mock.calls[0][0]).toEqual(built)
  })

  it('createAuth rejects when its plugin tuple does not match the resolved betterAuthPlugins', async () => {
    const pluginA = { id: 'plugin-a' }
    const differentInstance = { id: 'plugin-a' }
    const authConfig = makeAuthConfig({ betterAuthPlugins: [pluginA] })
    const opensaasConfig = makeOpensaasConfig(authConfig)
    const context = makeContext()

    const auth = createAuth(opensaasConfig, context, [differentInstance])

    await expect(auth.api.getSession({})).rejects.toThrow(
      /does not match the plugin array resolved/,
    )
    expect(betterAuthMock).not.toHaveBeenCalled()
  })
})

describe('buildBetterAuthOptions plugin-tuple argument', () => {
  beforeEach(() => {
    betterAuthMock.mockClear()
    prismaAdapterMock.mockClear()
    nextCookiesMock.mockClear()
  })

  it('rejects when the supplied tuple has a different length than the resolved betterAuthPlugins', async () => {
    const pluginA = { id: 'plugin-a' }
    const authConfig = makeAuthConfig({ betterAuthPlugins: [pluginA] })

    await expect(
      buildBetterAuthOptions(makeOpensaasConfig(authConfig), makeContext(), []),
    ).rejects.toThrow(/has 0 plugin\(s\), but the plugin array resolved.*has 1/)
  })

  it('rejects naming the mismatching index when a supplied plugin is not the same instance', async () => {
    const pluginA = { id: 'plugin-a' }
    const pluginB = { id: 'plugin-b' }
    const differentInstance = { id: 'plugin-a' } // same id, different identity

    const authConfig = makeAuthConfig({ betterAuthPlugins: [pluginA, pluginB] })

    await expect(
      buildBetterAuthOptions(makeOpensaasConfig(authConfig), makeContext(), [
        differentInstance,
        pluginB,
      ]),
    ).rejects.toThrow(/at index 0/)
  })

  it('rejects naming the mismatching index when the supplied order differs', async () => {
    const pluginA = { id: 'plugin-a' }
    const pluginB = { id: 'plugin-b' }
    const authConfig = makeAuthConfig({ betterAuthPlugins: [pluginA, pluginB] })

    await expect(
      buildBetterAuthOptions(makeOpensaasConfig(authConfig), makeContext(), [pluginB, pluginA]),
    ).rejects.toThrow(/at index 0/)
  })

  it('does not throw when the supplied tuple is the exact same instances in the same order', async () => {
    const pluginA = { id: 'plugin-a' }
    const pluginB = { id: 'plugin-b' }
    const authConfig = makeAuthConfig({ betterAuthPlugins: [pluginA, pluginB] })

    const config = await buildBetterAuthOptions(makeOpensaasConfig(authConfig), makeContext(), [
      pluginA,
      pluginB,
    ])

    expect(config.plugins).toEqual([pluginA, pluginB, { id: 'next-cookies' }])
  })

  it('appends exactly one nextCookies() plugin, last, whether or not a plugin tuple is supplied', async () => {
    const pluginA = { id: 'plugin-a' }
    const authConfig = makeAuthConfig({ betterAuthPlugins: [pluginA] })
    const opensaasConfig = makeOpensaasConfig(authConfig)
    const context = makeContext()

    const withoutArg = await buildBetterAuthOptions(opensaasConfig, context)
    expect(nextCookiesMock).toHaveBeenCalledTimes(1)
    expect(withoutArg.plugins).toEqual([pluginA, { id: 'next-cookies' }])

    nextCookiesMock.mockClear()

    const withArg = await buildBetterAuthOptions(opensaasConfig, context, [pluginA])
    expect(nextCookiesMock).toHaveBeenCalledTimes(1)
    expect(withArg.plugins).toEqual([pluginA, { id: 'next-cookies' }])
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

  it('propagates an error thrown by the underlying session lookup, distinguishable from no session', async () => {
    const getSession = vi.fn(async () => {
      throw new Error('boom')
    })
    const auth = { api: { getSession } } as unknown as Parameters<typeof getSessionFromAuth>[0]

    await expect(getSessionFromAuth(auth, ['userId'], new Headers())).rejects.toThrow('boom')
  })

  it('resolves the documented happy path unchanged: fields on the user, userId from user.id', async () => {
    const getSession = vi.fn(async () => ({
      user: { id: 'user-1', email: 'a@b.com', name: 'Ada' },
    }))
    const auth = { api: { getSession } } as unknown as Parameters<typeof getSessionFromAuth>[0]

    const result = await getSessionFromAuth(auth, ['userId', 'email', 'name'], new Headers())

    expect(result).toEqual({ userId: 'user-1', email: 'a@b.com', name: 'Ada' })
  })

  it('projects a customSession shape with no top-level user key instead of reporting anonymous', async () => {
    // A customSession plugin can fully replace the resolved shape (e.g.
    // nesting fields under a custom key) and drop the `user` object entirely
    // — that must still be treated as "a session", not "no session".
    const getSession = vi.fn(async () => ({
      email: 'nested@example.com',
      data: { role: 'admin' },
    }))
    const auth = { api: { getSession } } as unknown as Parameters<typeof getSessionFromAuth>[0]

    const result = await getSessionFromAuth(auth, ['email'], new Headers())

    expect(result).not.toBeNull()
    expect(result).toEqual({ email: 'nested@example.com' })
  })

  it('resolves a field living on the session sub-object, not just the user', async () => {
    const getSession = vi.fn(async () => ({
      user: { id: 'user-1' },
      session: { impersonatedBy: 'admin-1' },
    }))
    const auth = { api: { getSession } } as unknown as Parameters<typeof getSessionFromAuth>[0]

    const result = await getSessionFromAuth(auth, ['userId', 'impersonatedBy'], new Headers())

    expect(result).toEqual({ userId: 'user-1', impersonatedBy: 'admin-1' })
  })

  describe('resolution precedence', () => {
    it('prefers a top-level key over the same name on user or session (deliberate collision)', async () => {
      const getSession = vi.fn(async () => ({
        role: 'top-level-role',
        user: { role: 'user-role' },
        session: { role: 'session-role' },
      }))
      const auth = { api: { getSession } } as unknown as Parameters<typeof getSessionFromAuth>[0]

      const result = await getSessionFromAuth(auth, ['role'], new Headers())

      expect(result).toEqual({ role: 'top-level-role' })
    })

    it('prefers the user object over the session sub-object when there is no top-level key', async () => {
      const getSession = vi.fn(async () => ({
        user: { role: 'user-role' },
        session: { role: 'session-role' },
      }))
      const auth = { api: { getSession } } as unknown as Parameters<typeof getSessionFromAuth>[0]

      const result = await getSessionFromAuth(auth, ['role'], new Headers())

      expect(result).toEqual({ role: 'user-role' })
    })
  })

  // The warn-once cache is module-level state, so these tests re-import the
  // module fresh via vi.resetModules() — same pattern as the `select` no-op
  // warning tests in packages/core/tests/context.test.ts.
  describe('unresolved field warning', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>
    let freshGetSessionFromAuth: typeof getSessionFromAuth

    beforeEach(async () => {
      vi.resetModules()
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const mod = await import('../src/server/index.js')
      freshGetSessionFromAuth = mod.getSessionFromAuth
    })

    afterEach(() => {
      warnSpy.mockRestore()
    })

    it('omits an unresolvable field, warns once naming it, and does not throw', async () => {
      const getSession = vi.fn(async () => ({ user: { id: 'user-1' } }))
      const auth = { api: { getSession } } as unknown as Parameters<typeof getSessionFromAuth>[0]

      const result = await freshGetSessionFromAuth(auth, ['userId', 'nickname'], new Headers())

      expect(result).toEqual({ userId: 'user-1' })
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toContain('"nickname"')
    })

    it('does not warn again for the same field on a second call', async () => {
      const getSession = vi.fn(async () => ({ user: { id: 'user-1' } }))
      const auth = { api: { getSession } } as unknown as Parameters<typeof getSessionFromAuth>[0]

      await freshGetSessionFromAuth(auth, ['nickname'], new Headers())
      await freshGetSessionFromAuth(auth, ['nickname'], new Headers())

      expect(warnSpy).toHaveBeenCalledTimes(1)
    })
  })
})
