import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeAuthConfig } from '../src/config/index.js'

const noop = async () => {}

describe('default email senders', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('throws in production when password reset is enabled without sendResetPassword', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() =>
      normalizeAuthConfig({
        emailAndPassword: { enabled: true },
        passwordReset: { enabled: true },
      }),
    ).toThrow(/emailAndPassword\.sendResetPassword/)
  })

  it('does not throw in production when email/password is enabled without password reset', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => normalizeAuthConfig({ emailAndPassword: { enabled: true } })).not.toThrow()
  })

  it('throws in production when email verification is enabled without sendVerificationEmail', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => normalizeAuthConfig({ emailVerification: { enabled: true } })).toThrow(
      /emailVerification\.sendVerificationEmail/,
    )
  })

  it('does not throw in production when the callbacks are supplied', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() =>
      normalizeAuthConfig({
        emailAndPassword: { enabled: true, sendResetPassword: noop },
        passwordReset: { enabled: true },
        emailVerification: { enabled: true, sendVerificationEmail: noop },
      }),
    ).not.toThrow()
  })

  it('does not throw in production when the features are disabled', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => normalizeAuthConfig({})).not.toThrow()
  })

  it.each(['development', 'test', ''])('logs the URL when NODE_ENV is %j', async (env) => {
    vi.stubEnv('NODE_ENV', env)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = normalizeAuthConfig({ emailAndPassword: { enabled: true } })
    await result.emailAndPassword.sendResetPassword({
      user: { email: 'a@b.c' },
      url: 'http://x/reset-password/tok',
      token: 'tok',
    } as never)
    expect(log).toHaveBeenCalledWith('URL: http://x/reset-password/tok')
  })
})
