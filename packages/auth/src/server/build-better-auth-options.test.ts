import { describe, it, expectTypeOf } from 'vitest'
import { betterAuth } from 'better-auth'
import type { BetterAuthOptions } from 'better-auth'
import type { OpenSaasConfig, AccessContext } from '@opensaas/stack-core'
import { emailOTP, customSession } from 'better-auth/plugins'
import { buildBetterAuthOptions } from './index.js'

// The literal shape a `customSession()` callback replaces the session with —
// deliberately unlike better-auth's default `{ user, session }`, to prove the
// builder's return type carries a custom shape through to `api.getSession()`.
type AppSession = {
  data: { allowAdminUI: boolean; subjectId: string }
}

type TestPlugins = [ReturnType<typeof emailOTP>, ReturnType<typeof customSession<AppSession>>]

// `ReturnType<typeof buildBetterAuthOptions>` on the overloaded export itself
// resolves against its last (generic) signature, not the call-site-selected
// one — wrapping each call shape in its own ordinary function and reading
// `ReturnType<typeof wrapper>` instead forces TS to resolve overloads exactly
// as a real call site would.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- referenced only via `typeof` below
function callWithNoPlugins(
  config: OpenSaasConfig | Promise<OpenSaasConfig>,
  context: AccessContext | Promise<AccessContext>,
) {
  return buildBetterAuthOptions(config, context)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- referenced only via `typeof` below
function callWithPlugins(
  config: OpenSaasConfig | Promise<OpenSaasConfig>,
  context: AccessContext | Promise<AccessContext>,
  plugins: TestPlugins,
) {
  return buildBetterAuthOptions(config, context, plugins)
}

type NoArgResult = Awaited<ReturnType<typeof callWithNoPlugins>>
type BuiltOptionsWithPlugins = Awaited<ReturnType<typeof callWithPlugins>>
type ConstructedAuth = ReturnType<typeof betterAuth<BuiltOptionsWithPlugins>>

describe('buildBetterAuthOptions plugin-tuple typing', () => {
  it('back-compat: the no-argument call still returns the widened BetterAuthOptions', () => {
    expectTypeOf<NoArgResult>().toEqualTypeOf<BetterAuthOptions>()
  })

  it('preserves plugin-derived auth.api.* endpoints and a customSession shape', () => {
    // emailOTP() endpoints exist on the constructed Auth's `api` — erased entirely
    // when constructed from the widened `BetterAuthOptions` (see #876).
    expectTypeOf<ConstructedAuth['api']['signInEmailOTP']>().not.toBeNever()
    expectTypeOf<ConstructedAuth['api']['sendVerificationOTP']>().not.toBeNever()
    expectTypeOf<ConstructedAuth['api']['checkVerificationOTP']>().not.toBeNever()

    // customSession()'s replaced shape, not better-auth's default { user, session }.
    type GetSessionReturn = Awaited<ReturnType<ConstructedAuth['api']['getSession']>>
    expectTypeOf<GetSessionReturn>().toEqualTypeOf<AppSession | null>()
  })
})
