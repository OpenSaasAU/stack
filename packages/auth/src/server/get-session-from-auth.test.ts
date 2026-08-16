import { describe, it, expectTypeOf } from 'vitest'
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
