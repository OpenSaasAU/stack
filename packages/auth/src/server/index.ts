import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import type { Auth, BetterAuthOptions, BetterAuthPlugin } from 'better-auth'
import type { OpenSaasConfig, AccessContext, Session } from '@opensaas/stack-core'
import type { UnsafeSurface } from '@opensaas/stack-core/unsafe'
import { opensaasAuthAdapter } from '../adapter/index.js'
import { getAuthListRegistry } from '../lists/index.js'
import type { NormalizedAuthConfig, NormalizedAuthModelConfig } from '../config/types.js'

/**
 * `BetterAuthOptions['plugins']` narrowed to the app's literal tuple plus the
 * appended `nextCookies()` — see {@link buildBetterAuthOptions}'s tuple-typing
 * doc for why this matters.
 */
type ResolvedBetterAuthOptions<TPlugins extends readonly BetterAuthPlugin[]> = Omit<
  BetterAuthOptions,
  'plugins'
> & {
  plugins: [...TPlugins, ReturnType<typeof nextCookies>]
}

/**
 * Guard against the supplied plugin tuple silently drifting from the plugin
 * array actually resolved from `authPlugin({ betterAuthPlugins })` — the
 * supplied tuple exists for typing only, so if it isn't the exact same
 * instances in the exact same order, the type it produces would be a lie
 * about what `betterAuth()` is actually constructed with.
 */
function assertPluginTupleMatchesResolved(
  supplied: readonly BetterAuthPlugin[],
  resolved: readonly BetterAuthPlugin[],
): void {
  if (supplied.length !== resolved.length) {
    throw new Error(
      '[@opensaas/stack-auth] The plugin tuple passed to `buildBetterAuthOptions()` / `createAuth()` ' +
        `has ${supplied.length} plugin(s), but the plugin array resolved from \`authPlugin({ ` +
        `betterAuthPlugins })\` has ${resolved.length}. Pass the exact same array (without ` +
        '`nextCookies()` — the stack appends that itself).',
    )
  }

  const mismatchIndex = supplied.findIndex((plugin, index) => plugin !== resolved[index])
  if (mismatchIndex !== -1) {
    throw new Error(
      '[@opensaas/stack-auth] The plugin tuple passed to `buildBetterAuthOptions()` / `createAuth()` ' +
        `does not match the plugin array resolved from \`authPlugin({ betterAuthPlugins })\` at index ` +
        `${mismatchIndex} (got plugin "${supplied[mismatchIndex]?.id}", expected the same instance as ` +
        `"${resolved[mismatchIndex]?.id}"). Pass the exact same array — same instances, same order.`,
    )
  }
}

/**
 * Thrown when the context handed to `createAuth` carries no Unsafe surface.
 *
 * `AccessContext` deliberately does not name `unsafe` — the engine's own
 * handle and the application's deliberate bypass are different things under
 * different names (ADR-0038) — so the surface is read off the running request
 * context and checked here rather than typed into the signature.
 */
export class AuthUnsafeSurfaceMissingError extends Error {
  constructor() {
    super(
      '[@opensaas/stack-auth] The context passed to `createAuth()` / `buildBetterAuthOptions()` ' +
        "carries no Unsafe surface. The Auth adapter runs on Prisma 8's own query lanes, so " +
        'pass the generated `rawOpensaasContext` (or a context from `getContext()`), not a ' +
        'hand-built double.',
    )
    this.name = 'AuthUnsafeSurfaceMissingError'
  }
}

function isUnsafeSurface(value: unknown): value is UnsafeSurface {
  if (typeof value !== 'object' || value === null) return false
  return (
    typeof Reflect.get(value, 'query') === 'function' &&
    typeof Reflect.get(value, 'execute') === 'function'
  )
}

function getDatabaseConfig(
  opensaasConfig: OpenSaasConfig,
  authConfig: NormalizedAuthConfig,
  context: AccessContext,
): BetterAuthOptions['database'] {
  const unsafe = Reflect.get(context, 'unsafe')
  if (!isUnsafeSurface(unsafe)) throw new AuthUnsafeSurfaceMissingError()

  return opensaasAuthAdapter({
    config: opensaasConfig,
    unsafe,
    registry: getAuthListRegistry(authConfig.models, authConfig.betterAuthPlugins),
  })
}

/**
 * Returns `undefined` when there is nothing to override, so the running auth
 * instance keeps better-auth's own defaults untouched.
 */
function toBetterAuthModelOptions(
  model: NormalizedAuthModelConfig,
): { modelName?: string; fields?: Record<string, string> } | undefined {
  const hasFields = Object.keys(model.fields).length > 0
  const options: { modelName?: string; fields?: Record<string, string> } = {}
  if (model.modelName) options.modelName = model.modelName
  if (hasFields) options.fields = model.fields
  return Object.keys(options).length > 0 ? options : undefined
}

const MODELS_WITH_NO_ADDITIONAL_FIELDS_PASSTHROUGH = [
  'user',
  'session',
  'account',
  'verification',
] as const

/**
 * Reject `betterAuthOptions` keys that already have a dedicated, non-passthrough
 * seam — accepting them here would create two unranked ways to set the same
 * thing, or (for `additionalFields`) silently diverge from the generated
 * Prisma schema. See the `betterAuthOptions` doc comment on `AuthConfig`.
 */
function assertNoUnsupportedPassthroughKeys(betterAuthOptions: Record<string, unknown>): void {
  if ('database' in betterAuthOptions) {
    throw new Error(
      '[@opensaas/stack-auth] `betterAuthOptions.database` is not supported — the stack ' +
        'derives the database adapter from your `db` config and the running context. ' +
        'Configure the database through `db` in `opensaas.config.ts` instead.',
    )
  }

  if ('plugins' in betterAuthOptions) {
    throw new Error(
      '[@opensaas/stack-auth] `betterAuthOptions.plugins` is not supported — better-auth ' +
        'plugins are added through `authPlugin({ betterAuthPlugins: [...] })`, which the stack ' +
        'appends `nextCookies()` after. Use `betterAuthPlugins` instead.',
    )
  }

  const advanced = betterAuthOptions.advanced
  const advancedDatabase =
    advanced && typeof advanced === 'object' && !Array.isArray(advanced)
      ? Reflect.get(advanced, 'database')
      : undefined
  if (
    advancedDatabase &&
    typeof advancedDatabase === 'object' &&
    !Array.isArray(advancedDatabase)
  ) {
    if ('generateId' in advancedDatabase) {
      throw new Error(
        '[@opensaas/stack-auth] `betterAuthOptions.advanced.database.generateId` is not ' +
          "supported — the database mints auth ids (`db.idField: 'uuid7'`, pinned on every " +
          'list the auth plugin injects), so an app-supplied generator would write a non-UUID ' +
          'into a uuid column. Change the strategy through `db.idField` in `opensaas.config.ts` ' +
          'instead.',
      )
    }
    if ('joins' in advancedDatabase) {
      throw new Error(
        '[@opensaas/stack-auth] `betterAuthOptions.advanced.database.joins` is not supported — ' +
          'the Auth adapter implements no joins, and better-auth falls back to separate queries ' +
          'silently, so the flag would claim a capability nothing provides.',
      )
    }
  }

  const rateLimitOptions = betterAuthOptions.rateLimit
  if (
    rateLimitOptions &&
    typeof rateLimitOptions === 'object' &&
    !Array.isArray(rateLimitOptions) &&
    'storage' in rateLimitOptions
  ) {
    throw new Error(
      '[@opensaas/stack-auth] `betterAuthOptions.rateLimit.storage` is not supported — it has ' +
        'schema consequences (deriving the `RateLimit` list) that a passthrough cannot also ' +
        "apply to the generated Prisma schema. Use `authPlugin({ rateLimit: { storage: 'database' } })` " +
        'instead.',
    )
  }

  for (const model of MODELS_WITH_NO_ADDITIONAL_FIELDS_PASSTHROUGH) {
    const modelOptions = betterAuthOptions[model]
    if (
      modelOptions &&
      typeof modelOptions === 'object' &&
      !Array.isArray(modelOptions) &&
      'additionalFields' in modelOptions
    ) {
      throw new Error(
        `[@opensaas/stack-auth] \`betterAuthOptions.${model}.additionalFields\` is not ` +
          'supported — it adds columns that would not be reflected in the generated Prisma ' +
          'schema. Add fields to the derived list instead: ' +
          (model === 'user'
            ? '`extendUserList`, or declare the list yourself in your own `lists` config.'
            : 'declare the derived list yourself in your own `lists` config (the auth plugin ' +
              'merges in field additions for the models it derives).'),
      )
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function mergeBetterAuthOptions(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    const baseValue = result[key]
    result[key] =
      isPlainObject(baseValue) && isPlainObject(value)
        ? mergeBetterAuthOptions(baseValue, value)
        : value
  }
  return result
}

/**
 * Build the `BetterAuthOptions` a better-auth instance for this OpenSaas
 * config should be constructed with — the same options `createAuth()` uses
 * internally, available standalone for an app that still needs to hand-wire
 * its own `betterAuth()` instance (e.g. a third-party contract that requires
 * a resolved instance at module-init time). Keeps the auth plugin
 * authoritative for everything it models; the app's additions on top become
 * an explicit, reviewable diff instead of a parallel, hand-duplicated config.
 *
 * Called with just `(config, context)`, the return type is the widened
 * `BetterAuthOptions` — `betterAuth()` infers its plugin/session types from
 * the *literal* type of the options object, so constructing from this
 * widened return erases plugin endpoints (e.g. `emailOTP()`'s
 * `api.signInEmailOTP`) and a `customSession()` plugin's replaced session
 * shape. **If your app reads `auth.api.*` in typed code and uses either of
 * those, pass its plugin tuple as the third argument** — the exact same
 * array already passed to `authPlugin({ betterAuthPlugins })` — so the
 * return type carries the literal tuple instead:
 *
 * ```typescript
 * import { betterAuth } from 'better-auth'
 * import { emailOTP } from 'better-auth/plugins'
 * import { buildBetterAuthOptions } from '@opensaas/stack-auth/server'
 *
 * export const appBetterAuthPlugins = [emailOTP()] // same array passed to authPlugin({ betterAuthPlugins })
 *
 * export const auth = betterAuth({
 *   ...(await buildBetterAuthOptions(config, context, appBetterAuthPlugins)),
 *   databaseHooks: { user: { create: { after: syncDomainUser } } },
 * })
 * // auth.api.signInEmailOTP / auth.api.getSession()'s customSession shape are now typed.
 * ```
 *
 * The supplied tuple is for typing only — the array actually used at runtime
 * is always the one resolved from `authPlugin({ betterAuthPlugins })`, with
 * exactly one `nextCookies()` appended last. Passing a tuple that isn't the
 * same plugin instances in the same order throws, so the two can't silently
 * drift apart.
 *
 * Note `createAuth()`'s lazy Proxy does not behave identically to a real
 * `Auth` instance for every property (see its own doc comment) — reach for
 * this builder plus `betterAuth()` instead when the app reads `auth.api.*`
 * in typed code.
 */
export async function buildBetterAuthOptions(
  opensaasConfig: OpenSaasConfig | Promise<OpenSaasConfig>,
  context: AccessContext | Promise<AccessContext>,
): Promise<BetterAuthOptions>
export async function buildBetterAuthOptions<const TPlugins extends readonly BetterAuthPlugin[]>(
  opensaasConfig: OpenSaasConfig | Promise<OpenSaasConfig>,
  context: AccessContext | Promise<AccessContext>,
  plugins: TPlugins,
): Promise<ResolvedBetterAuthOptions<TPlugins>>
export async function buildBetterAuthOptions<const TPlugins extends readonly BetterAuthPlugin[]>(
  opensaasConfig: OpenSaasConfig | Promise<OpenSaasConfig>,
  context: AccessContext | Promise<AccessContext>,
  plugins?: TPlugins,
): Promise<BetterAuthOptions | ResolvedBetterAuthOptions<TPlugins>> {
  const resolvedConfig = await Promise.resolve(opensaasConfig)
  const resolvedContext = await Promise.resolve(context)

  const authConfig = resolvedConfig._pluginData?.auth as NormalizedAuthConfig | undefined

  if (!authConfig) {
    throw new Error(
      'Auth config not found. Make sure to use authPlugin() in your opensaas.config.ts',
    )
  }

  // `requireConfirmation` has no better-auth equivalent — it's a UI-only
  // concern the pre-built forms already take as their own
  // `requirePasswordConfirmation` prop. Warn rather than silently drop it,
  // since setting it here looks like it should do something.
  if (
    authConfig.emailAndPassword.enabled &&
    authConfig.emailAndPassword.requireConfirmation !== true
  ) {
    console.warn(
      '[@opensaas/stack-auth] `emailAndPassword.requireConfirmation` has no effect here — ' +
        'createAuth() has no better-auth option to forward it to. Pass ' +
        '`requirePasswordConfirmation` directly to <SignUpForm> / <ResetPasswordForm> instead.',
    )
  }

  // `passwordReset` is wired through better-auth's `emailAndPassword` config
  // (there's no password to reset without a password-based account), so it
  // silently has no effect if email/password auth itself isn't enabled.
  if (authConfig.passwordReset.enabled && !authConfig.emailAndPassword.enabled) {
    console.warn(
      '[@opensaas/stack-auth] `passwordReset.enabled` has no effect here — ' +
        '`emailAndPassword.enabled` is false, so there is no password-based account to reset.',
    )
  }

  assertNoUnsupportedPassthroughKeys(authConfig.betterAuthOptions as Record<string, unknown>)

  const resolvedPlugins = authConfig.betterAuthPlugins || []
  if (plugins) {
    assertPluginTupleMatchesResolved(plugins, resolvedPlugins)
  }

  const betterAuthConfig: BetterAuthOptions = {
    database: getDatabaseConfig(resolvedConfig, authConfig, resolvedContext),

    user: toBetterAuthModelOptions(authConfig.models.user),
    session: {
      ...toBetterAuthModelOptions(authConfig.models.session),
      expiresIn: authConfig.session.expiresIn || 604800,
      // better-auth treats `updateAge: 0` as "refresh on every request", not
      // "never refresh" — disabling refresh entirely requires its separate
      // `disableSessionRefresh` flag regardless of `updateAge`.
      ...(authConfig.session.updateAge === false
        ? { disableSessionRefresh: true }
        : { updateAge: authConfig.session.updateAge }),
    },
    account: toBetterAuthModelOptions(authConfig.models.account),
    verification: toBetterAuthModelOptions(authConfig.models.verification),

    emailAndPassword: authConfig.emailAndPassword.enabled
      ? {
          enabled: true,
          requireEmailVerification: authConfig.emailVerification.enabled,
          minPasswordLength: authConfig.emailAndPassword.minPasswordLength,
          ...(authConfig.passwordReset.enabled
            ? {
                sendResetPassword: authConfig.emailAndPassword.sendResetPassword,
                resetPasswordTokenExpiresIn: authConfig.passwordReset.tokenExpiration,
              }
            : {}),
        }
      : undefined,

    // Independent of `emailAndPassword` — also covers e.g. a social-provider
    // account whose email isn't yet verified.
    emailVerification: authConfig.emailVerification.enabled
      ? {
          sendVerificationEmail: authConfig.emailVerification.sendVerificationEmail,
          sendOnSignUp: authConfig.emailVerification.sendOnSignUp,
          expiresIn: authConfig.emailVerification.tokenExpiration,
        }
      : undefined,

    trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',') || [],

    socialProviders: Object.entries(authConfig.socialProviders)
      .filter(([_, config]) => config?.enabled !== false)
      .reduce(
        (acc, [provider, config]) => {
          if (config) {
            acc[provider] = {
              clientId: config.clientId,
              clientSecret: config.clientSecret,
            }
          }
          return acc
        },
        {} as Record<string, { clientId: string; clientSecret: string }>,
      ),

    // `modelName`/`fields` are only forwarded when `models.rateLimit` was
    // derived (rateLimit.storage === 'database') — mirroring the running
    // instance's model options back to the table the `RateLimit` Auth list
    // was derived from.
    rateLimit: authConfig.rateLimit
      ? {
          enabled: authConfig.rateLimit.enabled,
          window: authConfig.rateLimit.window,
          max: authConfig.rateLimit.max,
          ...(authConfig.rateLimit.storage ? { storage: authConfig.rateLimit.storage } : {}),
          ...(authConfig.models.rateLimit
            ? toBetterAuthModelOptions(authConfig.models.rateLimit)
            : {}),
        }
      : undefined,

    // nextCookies must be LAST so it can write the Set-Cookie headers
    // produced by any auth.api.* call inside a Next.js server action into
    // Next's cookie store — this is what makes the server-action auth forms
    // actually persist a session.
    plugins: [...resolvedPlugins, nextCookies()],
  }

  return mergeBetterAuthOptions(
    betterAuthConfig as unknown as Record<string, unknown>,
    authConfig.betterAuthOptions as Record<string, unknown>,
  ) as BetterAuthOptions | ResolvedBetterAuthOptions<TPlugins>
}

/**
 * Create a better-auth instance from OpenSaas config
 * This should be called once at app startup
 *
 * Returns a lazy `Proxy` (see the caveat below), typed as `Auth<BetterAuthOptions>`
 * when called with just `(config, context)` — the widened type, same erasure
 * caveat as {@link buildBetterAuthOptions}'s no-argument form. **If your app
 * reads `auth.api.*` in typed code and relies on a plugin's endpoints (e.g.
 * `emailOTP()`) or a `customSession()`'s replaced session shape, pass its
 * plugin tuple as the third argument** — the exact same array already passed
 * to `authPlugin({ betterAuthPlugins })` — so the declared type carries the
 * literal tuple instead:
 *
 * ```typescript
 * // lib/auth.ts
 * import { createAuth } from '@opensaas/stack-auth/server'
 * import config from '../opensaas.config'
 * import { rawOpensaasContext } from '@/.opensaas/context'
 *
 * export const appBetterAuthPlugins = [emailOTP()] // same array passed to authPlugin({ betterAuthPlugins })
 *
 * export const auth = createAuth(config, rawOpensaasContext, appBetterAuthPlugins)
 * ```
 *
 * As with the builder, the supplied tuple is for typing only, and a tuple
 * that isn't the same plugin instances in the same order throws.
 *
 * **Proxy caveat:** the lazy `Proxy` this returns does not behave identically
 * to a real `Auth` instance for every property — every access, including a
 * non-function property, is surfaced through an `async` wrapper (so e.g.
 * `auth.options` reads back as a `Promise`, not the plain object a real
 * instance would return synchronously). The declared type does not model
 * this difference; where it matters, reach for {@link buildBetterAuthOptions}
 * plus `betterAuth()` instead, which constructs a real instance.
 */
export function createAuth(
  opensaasConfig: OpenSaasConfig | Promise<OpenSaasConfig>,
  context: AccessContext | Promise<AccessContext>,
): Auth<BetterAuthOptions>
export function createAuth<const TPlugins extends readonly BetterAuthPlugin[]>(
  opensaasConfig: OpenSaasConfig | Promise<OpenSaasConfig>,
  context: AccessContext | Promise<AccessContext>,
  plugins: TPlugins,
): Auth<ResolvedBetterAuthOptions<TPlugins>>
export function createAuth<const TPlugins extends readonly BetterAuthPlugin[]>(
  opensaasConfig: OpenSaasConfig | Promise<OpenSaasConfig>,
  context: AccessContext | Promise<AccessContext>,
  plugins?: TPlugins,
): Auth<BetterAuthOptions> | Auth<ResolvedBetterAuthOptions<TPlugins>> {
  const configPromise = Promise.resolve(opensaasConfig)
  const contextPromise = Promise.resolve(context)

  type AuthInstance = Auth<BetterAuthOptions> | Auth<ResolvedBetterAuthOptions<TPlugins>>
  let authInstance: AuthInstance | null = null
  let authPromise: Promise<AuthInstance> | null = null

  async function getAuthInstance() {
    if (authInstance) return authInstance

    if (!authPromise) {
      authPromise = (async () => {
        const betterAuthConfig = plugins
          ? await buildBetterAuthOptions(configPromise, contextPromise, plugins)
          : await buildBetterAuthOptions(configPromise, contextPromise)
        authInstance = betterAuth(betterAuthConfig)
        return authInstance
      })()
    }

    return authPromise
  }

  return new Proxy({} as AuthInstance, {
    get(_, prop) {
      if (prop === 'then') {
        // Support await on the proxy itself
        return undefined
      }

      const lazyWrapper = async (...args: unknown[]) => {
        const instance = await getAuthInstance()
        const value = instance[prop as keyof typeof instance]
        if (typeof value === 'function') {
          return (value as (...args: unknown[]) => unknown).apply(instance, args)
        }
        return value
      }

      return new Proxy(lazyWrapper, {
        get(target, subProp) {
          if (subProp === 'then') {
            // Support await on nested properties
            return undefined
          }
          return async (...args: unknown[]) => {
            const instance = await getAuthInstance()
            const parentValue = instance[prop as keyof typeof instance]
            if (parentValue && typeof parentValue === 'object') {
              const childValue = (parentValue as Record<string, unknown>)[subProp as string]
              if (typeof childValue === 'function') {
                return (childValue as (...args: unknown[]) => unknown).apply(parentValue, args)
              }
              return childValue
            }
            throw new Error(
              `Property ${String(prop)}.${String(subProp)} not found on auth instance`,
            )
          }
        },
      })
    },
  })
}

/**
 * Field names already warned about failing to resolve against a session, so a
 * given field warns at most once per process rather than once per request.
 */
const unresolvedSessionFieldWarnings = new Set<string>()

function warnUnresolvedSessionField(field: string, resolvedSession: Record<string, unknown>): void {
  if (unresolvedSessionFieldWarnings.has(field)) return
  unresolvedSessionFieldWarnings.add(field)

  const user = isPlainObject(resolvedSession.user) ? resolvedSession.user : undefined
  const sessionRow = isPlainObject(resolvedSession.session) ? resolvedSession.session : undefined

  console.warn(
    `[@opensaas/stack-auth] sessionFields: "${field}" was not found on the resolved session. ` +
      `Checked its top-level keys (${Object.keys(resolvedSession).join(', ') || 'none'}), ` +
      `its "user" object (${user ? Object.keys(user).join(', ') || 'none' : 'not present'}), ` +
      `and its "session" object (${sessionRow ? Object.keys(sessionRow).join(', ') || 'none' : 'not present'}). ` +
      `The field is omitted from the projected session. A \`customSession\` plugin that nests this ` +
      `value elsewhere is the app's own to reconcile — see the \`sessionFields\` reference. ` +
      `This warning will not repeat for "${field}".`,
  )
}

function resolveSessionField(
  field: string,
  resolvedSession: Record<string, unknown>,
): { found: true; value: unknown } | { found: false } {
  const user = isPlainObject(resolvedSession.user) ? resolvedSession.user : undefined

  if (field === 'userId') {
    return user && 'id' in user ? { found: true, value: user.id } : { found: false }
  }

  if (field in resolvedSession) {
    return { found: true, value: resolvedSession[field] }
  }
  if (user && field in user) {
    return { found: true, value: user[field] }
  }
  const sessionRow = isPlainObject(resolvedSession.session) ? resolvedSession.session : undefined
  if (sessionRow && field in sessionRow) {
    return { found: true, value: sessionRow[field] }
  }
  return { found: false }
}

/**
 * Get session from better-auth and transform it to OpenSaas session format —
 * a flattened projection of `sessionFields` off the *resolved* session
 * object, not just its `user` sub-object. This is what makes a
 * `customSession` plugin's fields (added at the top level, or a
 * session-only field like the admin plugin's `impersonatedBy`) reachable.
 * See the `sessionFields` reference for the resolution precedence.
 *
 * Returns `null` only when there is genuinely no session — a resolved
 * session with no `user` key (a `customSession` plugin that dropped it) is
 * still a session and still gets projected, never misreported as anonymous.
 * A listed field that can't be resolved from the session shape is omitted
 * and warns once per field per process (see `warnUnresolvedSessionField`)
 * instead of silently vanishing into an access-control function reading
 * `undefined`.
 *
 * Errors from the underlying `auth.api.getSession()` call propagate rather
 * than becoming `null` — collapsing a lookup failure (e.g. a session-store
 * outage) into "anonymous" is indistinguishable from a mass sign-out under
 * fail-closed access control, so the caller must see it.
 *
 * Pass the caller's request headers (e.g. Next.js `await headers()` in a
 * Server Component/action) so a session cookie can actually be resolved.
 *
 * `auth` is typed structurally over just the one member this function reads
 * — `api.getSession` — rather than a single concrete `Auth<Options>`
 * instantiation, so it accepts an instance from either `createAuth()`
 * overload: the widened `Auth<BetterAuthOptions>`, or the narrowed
 * `Auth<ResolvedBetterAuthOptions<TPlugins>>` returned when a plugin tuple is
 * passed. `TResolvedSession` is inferred from whatever `auth.api.getSession`
 * actually returns (the default `{ session, user }` shape, or a
 * `customSession` plugin's replaced shape) — it is not constrained, so no
 * `any`/`unknown` is introduced at the call boundary.
 */
export async function getSessionFromAuth<TResolvedSession>(
  auth: { api: { getSession: (args: { headers: Headers }) => Promise<TResolvedSession> } },
  sessionFields: string[],
  headers: Headers,
): Promise<Session | null> {
  const resolvedSession = await auth.api.getSession({ headers })

  if (!resolvedSession) {
    return null
  }

  const resolvedSessionRecord = resolvedSession as Record<string, unknown>
  const result: Record<string, unknown> = {}

  for (const field of sessionFields) {
    const resolved = resolveSessionField(field, resolvedSessionRecord)
    if (resolved.found) {
      result[field] = resolved.value
    } else {
      warnUnresolvedSessionField(field, resolvedSessionRecord)
    }
  }

  return result
}

export type { BetterAuthOptions }
