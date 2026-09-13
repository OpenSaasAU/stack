import { describe, it, expect, expectTypeOf } from 'vitest'
import type { OpenSaasConfig, AccessContext, Session } from '@opensaas/stack-core'
import { emailOTP } from 'better-auth/plugins'
import { createAuth, getSessionFromAuth } from './index.js'

// Type-level regression coverage for #906: `getSessionFromAuth` must accept
// an auth instance from either `createAuth()` overload — the widened
// `Auth<BetterAuthOptions>` returned with no plugin tuple, and the narrowed
// `Auth<ResolvedBetterAuthOptions<TPlugins>>` returned when one is passed —
// with no cast and no intermediate widening assignment. `Parameters<typeof
// createAuth>` on the overloaded export resolves against its last (generic)
// signature rather than the call-site-selected one, so each call shape is
// wrapped in its own ordinary function and read back via `typeof`, mirroring
// `build-better-auth-options.test.ts`.
type TestPlugins = [ReturnType<typeof emailOTP>]

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- referenced only via `typeof` below
function callWithNoPlugins(
  config: OpenSaasConfig | Promise<OpenSaasConfig>,
  context: AccessContext | Promise<AccessContext>,
) {
  return createAuth(config, context)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- referenced only via `typeof` below
function callWithPlugins(
  config: OpenSaasConfig | Promise<OpenSaasConfig>,
  context: AccessContext | Promise<AccessContext>,
  plugins: TestPlugins,
) {
  return createAuth(config, context, plugins)
}

type WidenedAuth = ReturnType<typeof callWithNoPlugins>
type NarrowedAuth = ReturnType<typeof callWithPlugins>

describe('getSessionFromAuth accepts either createAuth() overload (#906)', () => {
  it('accepts the widened Auth<BetterAuthOptions> instance with no cast', () => {
    expectTypeOf<WidenedAuth>().toExtend<Parameters<typeof getSessionFromAuth>[0]>()
  })

  it('accepts the narrowed, plugin-typed Auth instance with no cast', () => {
    // This is the exact case #906 reported as a type error: a `createAuth`
    // instance narrowed by a plugin tuple, passed straight into
    // `getSessionFromAuth` without widening it back to `Auth<BetterAuthOptions>`.
    expectTypeOf<NarrowedAuth>().toExtend<Parameters<typeof getSessionFromAuth>[0]>()
  })

  it('return type stays Promise<Session | null>, unchanged by the widened/narrowed instance', () => {
    expectTypeOf(getSessionFromAuth).returns.toEqualTypeOf<Promise<Session | null>>()
  })
})

/**
 * `getContext` refuses a session holding `undefined` for one of its own
 * keys (#1397). A `sessionFields` entry that resolves to a key present with
 * an explicit `undefined` value — a `customSession` plugin field that is
 * there but unset, say — must be omitted from the projected session rather
 * than passed through, or a genuinely signed-in session would hit that
 * refusal.
 */
describe('getSessionFromAuth omits a field resolved to undefined (#1397)', () => {
  const authWith = (user: Record<string, unknown>) => ({
    api: { getSession: async () => ({ user }) },
  })

  it('drops the field rather than handing getContext a key set to undefined', async () => {
    const session = await getSessionFromAuth(
      authWith({ id: 'user-1', role: undefined }),
      ['userId', 'role'],
      new Headers(),
    )

    // `toEqual` treats a key holding `undefined` as equal to an absent one,
    // which is exactly the distinction under test — assert the key is
    // actually gone, not merely that it reads as `undefined`.
    expect(session).not.toBeNull()
    expect(Object.prototype.hasOwnProperty.call(session, 'role')).toBe(false)
    expect(session).toStrictEqual({ userId: 'user-1' })
  })

  it('still projects the field when it resolves to a real value', async () => {
    const session = await getSessionFromAuth(
      authWith({ id: 'user-1', role: 'admin' }),
      ['userId', 'role'],
      new Headers(),
    )

    expect(session).toEqual({ userId: 'user-1', role: 'admin' })
  })
})
