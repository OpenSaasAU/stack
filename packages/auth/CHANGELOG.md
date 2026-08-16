# @opensaas/stack-auth

## 0.39.0

### Minor Changes

- [#928](https://github.com/OpenSaasAU/stack/pull/928) [`d5a04bb`](https://github.com/OpenSaasAU/stack/commit/d5a04bb7936a2663fbbfcacbf44f777d423dbc05) Thanks [@borisno2](https://github.com/borisno2)! - Add a `rateLimit.storage` option to `authPlugin`. Setting it to `'database'` derives a fifth `RateLimit` Auth list, mirroring better-auth's own database-backed rate limiter table (`key`/`count`/`lastRequest`, no timestamps, no defaults) so an app that wants a persisted limiter no longer has to hand-write the model.

  ```typescript
  authPlugin({
    rateLimit: {
      enabled: true,
      storage: 'database',
    },
  })
  ```

  `rateLimit` also carries the same `modelName`/`fields`/`tableName`/`schema` adoption knobs as the other four models, so an app with an existing limiter table can adopt it. `access.rateLimit` grants access to the derived list (closed by default, per ADR-0013). `adoptBetterAuthTables({ rateLimit: true })` adopts an existing database-backed limiter table alongside the other four. Setting `rateLimit.storage` via the `betterAuthOptions` passthrough is now rejected — use the first-class option instead.

### Patch Changes

- [#930](https://github.com/OpenSaasAU/stack/pull/930) [`bb04e44`](https://github.com/OpenSaasAU/stack/commit/bb04e44c0f758e00b61d34efc829d0d25b0be3d2) Thanks [@borisno2](https://github.com/borisno2)! - Fix the better-auth schema converter mapping a `bigint: true` field attribute to a 32-bit `Int` instead of a `BigInt` column, which silently overflowed on values like a millisecond epoch.

- [#923](https://github.com/OpenSaasAU/stack/pull/923) [`d0763c5`](https://github.com/OpenSaasAU/stack/commit/d0763c56ff15dd3bb16e00e5dae4d216b7bbdbaf) Thanks [@borisno2](https://github.com/borisno2)! - `getSessionFromAuth()` now accepts an auth instance from either `createAuth()` overload — including the plugin-narrowed one — without a cast.

## 0.38.0

### Minor Changes

- [#888](https://github.com/OpenSaasAU/stack/pull/888) [`8183827`](https://github.com/OpenSaasAU/stack/commit/8183827ec65d6cfd7153028f84057ab65dfdc7dd) Thanks [@borisno2](https://github.com/borisno2)! - `buildBetterAuthOptions()` and `createAuth()` now accept an optional third argument — your app's `betterAuthPlugins` array, the same array passed to `authPlugin({ betterAuthPlugins })` — so the returned options/`Auth` type carries the literal plugin tuple instead of the widened `BetterAuthOptions`/`Auth<BetterAuthOptions>`. Without this, `betterAuth()` constructed from the widened return loses plugin-derived `auth.api.*` endpoints (e.g. `emailOTP()`'s `signInEmailOTP`) and a `customSession()` plugin's replaced session shape.

  ```typescript
  export const appBetterAuthPlugins = [emailOTP({ sendVerificationOTP })] // same array passed to authPlugin({ betterAuthPlugins })

  export const auth = betterAuth({
    ...(await buildBetterAuthOptions(config, rawOpensaasContext, appBetterAuthPlugins)),
  })
  // auth.api.signInEmailOTP is now typed, and auth.api.getSession() returns your customSession() shape.
  ```

  The supplied tuple is for typing only — the plugin array used at runtime is always the one resolved from `authPlugin({ betterAuthPlugins })`. Passing a tuple that isn't the same plugin instances in the same order throws, naming the mismatch, so the two can't silently drift apart. Calling either function with no third argument is unchanged — same widened return type, same runtime options, fully backwards compatible.

  Also, `AuthConfig`/`NormalizedAuthConfig`'s `betterAuthPlugins` field is now typed as better-auth's own `BetterAuthPlugin[]` instead of `any[]`.

- [#889](https://github.com/OpenSaasAU/stack/pull/889) [`b9b9357`](https://github.com/OpenSaasAU/stack/commit/b9b935719774b01a81cfd2082387b76806c1a484) Thanks [@borisno2](https://github.com/borisno2)! - Fix `getSessionFromAuth` to project `sessionFields` from the _resolved_ better-auth session instead of only its `user` sub-object. A `customSession` plugin's replaced shape with no `user` key is now correctly treated as a signed-in session (never misreported as anonymous), and a session-only field (e.g. the admin plugin's `impersonatedBy`) is now resolvable. Errors from the underlying session lookup now propagate instead of silently becoming `null`, and a `sessionFields` entry that can't be resolved is omitted and logs a warning (once per field, per process) instead of vanishing silently.

  The scaffolded `getSession()` — the CLI feature generator's `lib/auth.ts` template, and `examples/starter-auth`/`examples/auth-demo` — now call this single shared helper, reading `sessionFields` from the resolved config at runtime instead of baking a field list in at generation time. `examples/auth-demo`'s `getSession()` also now correctly returns `null` for an anonymous visitor (previously returned a truthy object of `undefined` values).

  ```typescript
  authPlugin({ sessionFields: ['userId', 'email', 'name', 'role'] })
  ```

  ```typescript
  // lib/auth.ts
  export async function getSession() {
    const resolvedConfig = await config
    const authConfig = resolvedConfig._pluginData?.auth as NormalizedAuthConfig | undefined
    const sessionFields = authConfig?.sessionFields ?? ['userId', 'email', 'name']
    return getSessionFromAuth(auth, sessionFields, await headers())
  }
  ```

## 0.37.0

### Minor Changes

- [#872](https://github.com/OpenSaasAU/stack/pull/872) [`17acf04`](https://github.com/OpenSaasAU/stack/commit/17acf046b494da184c2b77434a7b4d3400ca32f2) Thanks [@borisno2](https://github.com/borisno2)! - `createAuth()` now forwards `AuthConfig` options it previously normalized but silently dropped: `emailAndPassword.minPasswordLength`, `passwordReset.enabled`/`tokenExpiration` (wired to better-auth's `sendResetPassword`), and `emailVerification.enabled`/`sendOnSignUp`/`tokenExpiration` (wired to `sendVerificationEmail`).

  The stack does not wrap these email callbacks in any way — `emailAndPassword.sendResetPassword` and `emailVerification.sendVerificationEmail` are better-auth's own option shape, forwarded straight through, so an app configures them exactly as it would when calling `betterAuth()` directly:

  ```typescript
  authPlugin({
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        await resend.emails.send({
          to: user.email,
          subject: 'Reset your password',
          html: `<a href="${url}">Reset your password</a>`,
        })
      },
    },
    emailVerification: {
      enabled: true,
      sendVerificationEmail: async ({ user, url }) => {
        await resend.emails.send({
          to: user.email,
          subject: 'Verify your email',
          html: `<a href="${url}">Verify your email</a>`,
        })
      },
    },
  })
  ```

  If not provided, reset/verification emails are logged to console instead of sent — apps relying on the previous no-op behavior (verification/reset emails silently not sending) will start sending real emails once `emailVerification`/`passwordReset` are enabled and these callbacks are configured.

  Two related fixes, both changing existing behavior:

  - `session.updateAge` is retyped from `boolean` to `number | false` — the number of seconds between session refreshes, passed straight through to better-auth's own `session.updateAge` instead of being computed as `expiresIn / 10`. The default changes from `true` to `86400` (1 day), matching better-auth's own default. Update any `updateAge: true` config to a duration in seconds (e.g. `86400`). `updateAge: false` now correctly maps to better-auth's `disableSessionRefresh: true` (previously it mapped to `updateAge: 0`, which better-auth treats as "refresh on every request" — the opposite of disabling refresh).
  - `getSessionFromAuth(auth, sessionFields, headers)` gains a required third `headers: Headers` parameter. Previously it always called `auth.api.getSession({ headers: new Headers() })`, an empty header set that could never resolve a session cookie, so the function always returned `null`. Callers must now pass the request's real headers (e.g. Next.js `await headers()`).

  Setting `emailAndPassword.requireConfirmation` (while `emailAndPassword.enabled` is true) now logs a `console.warn` — it has no better-auth server-side equivalent (it's a UI-only "confirm password" concern). Pass `requirePasswordConfirmation` directly to `<SignUpForm>`/`<ResetPasswordForm>` instead. Similarly, `passwordReset.enabled` now warns if `emailAndPassword.enabled` is false, since password reset has no effect without a password-based account.

- [#871](https://github.com/OpenSaasAU/stack/pull/871) [`06375ca`](https://github.com/OpenSaasAU/stack/commit/06375cad571677e92bfe84c35ff55240f3546a1f) Thanks [@{](https://github.com/{)! - Add a per-model `tableName` option, independent of `modelName`, so a renamed Auth list key can still adopt a differently-named live table — most commonly better-auth's own default lowercase table names (`user`, `session`, `account`, `verification`).

  ```typescript
  authPlugin({
   modelName: 'AuthUser', tableName: 'user' },
    session: { modelName: 'AuthSession', tableName: 'session' },
  })
  ```

  `adoptBetterAuthTables()` gains matching `useBetterAuthTableNames` and `tableNames` options:

  ```typescript
  adoptBetterAuthTables({ useBetterAuthTableNames: true })
  // or explicitly:
  adoptBetterAuthTables({ tableNames: { user: 'user', session: 'session' } })
  ```

  With no `tableName` set, behaviour is unchanged: the table name still follows `modelName` when it differs from the better-auth default, otherwise no `@@map` is emitted.

- [#874](https://github.com/OpenSaasAU/stack/pull/874) [`7ef9dbc`](https://github.com/OpenSaasAU/stack/commit/7ef9dbc2f94cc4e7ab831ecafb3ef65159a3c55e) Thanks [@borisno2](https://github.com/borisno2)! - Add a `betterAuthOptions` escape hatch on `AuthConfig` for better-auth options the stack doesn't model, plus an exported `buildBetterAuthOptions()` builder for apps that still need to hand-wire their own `betterAuth()` instance.

  `betterAuthOptions` is deep-merged onto the options `createAuth()` builds, applied last — a plain-object value merges recursively alongside sibling keys the stack already set (e.g. `session: { cookieCache }` doesn't clobber `session.expiresIn`), and wins on any genuine key collision:

  ```typescript
  authPlugin({
    betterAuthOptions: {
      databaseHooks: { user: { create: { after: syncDomainUser } } },
      session: { cookieCache: { enabled: true, maxAge: 300 } },
      verification: { storeIdentifier: 'hashed' },
      baseURL: process.env.BETTER_AUTH_URL,
    },
  })
  ```

  `database`, `plugins`, and `additionalFields` under `user`/`session`/`account`/`verification` are rejected — they already have dedicated seams (`db` config, `betterAuthPlugins`), or have schema consequences a passthrough can't also apply to the generated Prisma schema.

  `buildBetterAuthOptions(config, context)` returns the exact same options object `createAuth()` uses, for apps that need a resolved `betterAuth()` instance rather than `createAuth()`'s lazy proxy:

  ```typescript
  import { betterAuth } from 'better-auth'
  import { buildBetterAuthOptions } from '@opensaas/stack-auth/server'

  export const auth = betterAuth({
    ...(await buildBetterAuthOptions(config, rawOpensaasContext)),
    databaseHooks: { user: { create: { after: syncDomainUser } } },
  })
  ```

- [#870](https://github.com/OpenSaasAU/stack/pull/870) [`7b6189f`](https://github.com/OpenSaasAU/stack/commit/7b6189fa60119a45082ba62dd71d915d93de529c) Thanks [@relationship({](https://github.com/relationship({)! - A relationship field's foreign key can now be declared non-nullable via `db.isNullable: false` — the generated FK column and its relation field lose their `?` together. Omitting the option leaves every existing relationship unchanged (still nullable by default).

  ```typescript

    ref: 'User.sessions',
    db: { isNullable: false },
  })
  // Generates: userId String  (was String?)
  //            user   User    @relation(...)  (was User?)
  ```

  `@opensaas/stack-auth`'s derived Auth lists now use this to match better-auth's own Prisma schema: `Session.expiresAt`, `Verification.expiresAt`, and the `Session.user`/`Account.user` foreign keys generate as required instead of nullable.

  **Migration note:** this changes the generated schema for existing greenfield apps. Running `opensaas generate` followed by `prisma db push`/`prisma migrate dev` will produce a migration that adds `NOT NULL` to `Session.expiresAt`, `Verification.expiresAt`, `Session.userId`, and `Account.userId`. Since better-auth's own adapter always writes these columns, no existing row should violate the new constraint — but back up production data before applying, as with any schema migration.

### Patch Changes

- [#867](https://github.com/OpenSaasAU/stack/pull/867) [`43b4d17`](https://github.com/OpenSaasAU/stack/commit/43b4d1738340f05b1cf8bec3315927b3004816dd) Thanks [@borisno2](https://github.com/borisno2)! - Fix a better-auth plugin's schema extension of a base model (`user`/`session`/`account`/`verification`) silently dropping the derived Auth list's `db` (`map`/`schema`/`timestamps`) and `access` config.

## 0.36.0

## 0.35.0

## 0.34.0

## 0.33.0

## 0.32.0

### Minor Changes

- [#813](https://github.com/OpenSaasAU/stack/pull/813) [`5a6198c`](https://github.com/OpenSaasAU/stack/commit/5a6198c9489641e4b1ad542a3181c15e750f7d85) Thanks [@borisno2](https://github.com/borisno2)! - Auth forms now submit through app-owned server actions instead of the browser `authClient`

  The pre-built auth forms (`SignInForm`, `SignUpForm`, `ForgotPasswordForm`, and the new
  `ResetPasswordForm`) no longer take an `authClient` prop that calls `/api/auth/*` from the
  browser. Instead each form takes **server action** props — `'use server'` functions the app
  defines against its own `auth` instance. This keeps the auth network surface server-side and
  matches the app's existing `lib/actions/*` convention. `createAuth` now auto-adds
  better-auth's `nextCookies` plugin, so the session cookie set inside a server action persists.
  See ADR-0020.

  The package exports the action contract types (`AuthActionResult`, `SignInInput`,
  `SignUpInput`, `RequestPasswordResetInput`, `ResetPasswordInput`, and the action aliases).
  `createClient` is unchanged for client-side session reading (`useSession`).

  Migration — define the actions in your app and pass them to the forms:

  ```typescript
  // lib/actions/auth.ts
  'use server'
  import { headers } from 'next/headers'
  import { auth } from '@/lib/auth'
  import type { AuthActionResult, SignInInput } from '@opensaas/stack-auth/ui'

  export async function signInAction(input: SignInInput): Promise<AuthActionResult> {
    try {
      await auth.api.signInEmail({
        body: { email: input.email, password: input.password },
        headers: await headers(),
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Sign in failed' }
    }
  }
  ```

  ```tsx
  // Before
  <SignInForm authClient={authClient} redirectTo="/admin" />

  // After
  <SignInForm signInAction={signInAction} redirectTo="/admin" />
  ```

  Social sign-in becomes a redirecting server action passed as `signInSocialAction`. The CLI
  feature-generator now scaffolds `lib/actions/auth.ts` and a `reset-password` page, and no
  longer emits `lib/auth-client.ts`.

## 0.31.1

## 0.31.0

### Patch Changes

- [#772](https://github.com/OpenSaasAU/stack/pull/772) [`be5772b`](https://github.com/OpenSaasAU/stack/commit/be5772be231d5be6a77d80c4f7eff5adc15da2fa) Thanks [@borisno2](https://github.com/borisno2)! - Add a regression test locking the generated Session/Account user FK shape (no `@@index([userId])`, `onDelete: Cascade`) so future drift from better-auth parity is caught.

## 0.30.0

### Patch Changes

- [#741](https://github.com/OpenSaasAU/stack/pull/741) [`afa865f`](https://github.com/OpenSaasAU/stack/commit/afa865f62ed7968b494a87e0621cf71bacd36f39) Thanks [@borisno2](https://github.com/borisno2)! - Update documentation links to the restructured docs site URLs (Diátaxis layout)

- [#744](https://github.com/OpenSaasAU/stack/pull/744) [`5e135ef`](https://github.com/OpenSaasAU/stack/commit/5e135ef635dd7cd97ab106f46fbf808250aa079e) Thanks [@borisno2](https://github.com/borisno2)! - Fix stale `withMcpAuth` JSDoc example that imported a nonexistent generated module

## 0.29.0

## 0.28.0

### Minor Changes

- [#696](https://github.com/OpenSaasAU/stack/pull/696) [`0bcfb4a`](https://github.com/OpenSaasAU/stack/commit/0bcfb4a6f1183ee75017bee73566f5aaa3b5408e) Thanks [@{](https://github.com/{)! - BREAKING: Auth-injected lists (User/Session/Account/Verification) now ship **closed** — no operation-level access — instead of shipping permissive defaults (`query: () => true`, self-only update/delete). Per ADR-0013, access control belongs to the application. With no access configured, `context.db` reads/writes against these lists return `null`/`[]` and they no longer appear in the admin UI. better-auth's own sign-in/sign-up/session flows are unaffected — they write through the raw Prisma client, bypassing access control entirely.

  Grant access with the new `authPlugin({ access: { ... } })` passthrough, keyed by better-auth model name (`user`/`session`/`account`/`verification` — not the derived list key, so it stays correct if you rename a model via `modelName`). Each entry is a full list access config (operation and field-level):

  ```typescript
  authPlugin({
    access: {

        operation: {
          query: ({ session }) => !!session,
          update: ({ session, item }) => session?.userId === item.id,
        },
      },
      session: {
        operation: {
          query: ({ session }) => (session ? { user: { id: { equals: session.userId } } } : false),
        },
      },
    },
  })
  ```

  For the User list specifically, `extendUserList.access` (unchanged) still works and takes precedence over `access.user` if both are set.

  The runtime `getUser`/`getCurrentUser` helpers now resolve through the `sudo` helper `@opensaas/stack-core` passes to `plugin.runtime(context, sudo)`, so "who is this session" no longer depends on the application's User list access policy.

  Migration: if you relied on the old permissive defaults, add the equivalent rules under `authPlugin({ access: { ... } })` for any Auth list your app reads or writes through `context.db` or the admin UI.

- [#698](https://github.com/OpenSaasAU/stack/pull/698) [`cf8b4bd`](https://github.com/OpenSaasAU/stack/commit/cf8b4bd17af15c5dadc898e76465913909c74c89) Thanks [@borisno2](https://github.com/borisno2)! - The derived `Session.user` and `Account.user` foreign keys now mirror a live better-auth database's shape: no `@@index([userId])` (better-auth carries no separate FK index) and `onDelete: Cascade` (Prisma's default was `Restrict`). This applies to both greenfield installs and adopted databases, so a generated Auth schema diffs clean against a standard better-auth Prisma schema.

  Migration note: existing greenfield stack-auth apps will see a schema diff on next `pnpm generate` — a migration that drops the `userId` index on `Session`/`Account` and adds `onDelete: Cascade` to both foreign keys. Review the generated migration before applying it; deleting a user now cascades to their sessions and accounts instead of being blocked.

### Patch Changes

- [#689](https://github.com/OpenSaasAU/stack/pull/689) [`8db2c57`](https://github.com/OpenSaasAU/stack/commit/8db2c57130f270b73a6a007312d743cac97a8743) Thanks [@borisno2](https://github.com/borisno2)! - Fix better-auth plugin schema extensions (e.g. `user`) resolving against a re-derived list key instead of the configured model-key remap, which could silently apply the extension's fields/access to an unrelated host list sharing the default key.

- [#695](https://github.com/OpenSaasAU/stack/pull/695) [`fd64913`](https://github.com/OpenSaasAU/stack/commit/fd64913ac65ed60440eaee210a34a6f8e3824c21) Thanks [@borisno2](https://github.com/borisno2)! - Fix a plugin's `extendList()` silently overwriting a pre-existing list's operation-level access. Per ADR-0013, an extension that carries `access.operation` for an existing list now throws a config-time error naming the plugin and the list; the auth plugin no longer forwards its own access when extending a list an app already declared.

## 0.27.1

## 0.27.0

### Patch Changes

- [#664](https://github.com/OpenSaasAU/stack/pull/664) [`37838ef`](https://github.com/OpenSaasAU/stack/commit/37838efbf726b27baa5e1da448d44223c6953e3f) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade TypeScript to v7. `typescript` now resolves to the `@typescript/typescript6` compatibility shim (keeping the classic compiler API available for `typescript-eslint` and Next.js's build-time type-checking, neither of which support TS 7's restructured package yet), while `@typescript-eslint/eslint-plugin` is bumped to 8.63.0 to match. The CLI's Node-build compiler step (ADR-0011) now shells out to `tsc` instead of the removed synchronous `Program` API, using its own pinned native TS 7 binary via a new `@typescript/native` dependency.

## 0.26.0

## 0.25.0

## 0.24.0

## 0.23.0

## 0.22.0

### Minor Changes

- [#509](https://github.com/OpenSaasAU/stack/pull/509) [`fdc48f8`](https://github.com/OpenSaasAU/stack/commit/fdc48f86a5a7f161bef0b512963e1511a8c8e00e) Thanks [@list({](https://github.com/list({)! - Add `adoptBetterAuthTables()` recipe for adopting an existing better-auth installation

  A migrating project that already runs better-auth (its `AuthUser`/`AuthSession`/`AuthAccount`/`AuthVerification` tables live in a separate `auth` Postgres schema, and its app `User` is a different model) can now adopt those live tables without rebuilding the auth config by hand. The recipe presets the plugin-level `schema` plus each model's `modelName` (and optional column `fields` maps) to the conventions of a standard separate-schema better-auth install, so the derived Auth lists diff clean (Schema parity) against the live database — no destructive auth migration. The app's own domain `User` is left untouched; linking it to the Auth identity is the application's concern.

  ```typescript
  import { config } from '@opensaas/stack-core'
  import { authPlugin, adoptBetterAuthTables } from '@opensaas/stack-auth'

  export default config({
    db: { provider: 'postgresql', url: process.env.DATABASE_URL },
    plugins: [
      authPlugin({
        // Defaults: AuthUser/AuthSession/AuthAccount/AuthVerification in the
        // `auth` schema, pinned to your live table names (@@map) + schema (@@schema).
        ...adoptBetterAuthTables(),
        emailAndPassword: { enabled: true },
      }),
    ],
    lists: {
      // Your own domain User stays in `public` and is NOT touched by the plugin.
   fields: { subjectId: text({ validation: { isRequired: true } }) } }),
    },
  })

  // Customise when your live tables diverge from the defaults:
  adoptBetterAuthTables({
    schema: 'identity', // default: 'auth'
    modelNamePrefix: 'BA', // default: 'Auth'
    fields: { user: { name: 'full_name' }, session: { userId: 'user_id' } },
  })
  ```

- [#497](https://github.com/OpenSaasAU/stack/pull/497) [`be4181a`](https://github.com/OpenSaasAU/stack/commit/be4181ada3f2d6386052df4d4869ad150d360f89) Thanks [@{](https://github.com/{)! - Derive the auth plugin's Auth lists from the better-auth config

  `authPlugin` now mirrors the better-auth config a developer writes instead of hardcoding the keys `User`/`Session`/`Account`/`Verification`. Per-model `modelName` becomes the OpenSaaS list key (and a table `@@map`), and the `fields` column map becomes per-field `@map`s. The plugin only ever adds/extends its own derived keys, so an app's separate domain `User` is never overwritten. The runtime `getUser`/`getCurrentUser` helpers now resolve the user list key from the configured user model instead of a hardcoded `'user'`.

  Default behaviour (no overrides) is unchanged: the lists are still keyed `User`/`Session`/`Account`/`Verification` with the original field shapes and no `@@map`.

  ```typescript
  // Adopt existing better-auth tables without a destructive migration
  authPlugin({
   modelName: 'AuthUser', fields: { name: 'full_name' } },
    session: { modelName: 'AuthSession', fields: { userId: 'user_id' } },
    account: { modelName: 'AuthAccount' },
    verification: { modelName: 'AuthVerification' },
  })
  // -> lists keyed AuthUser/AuthSession/AuthAccount/AuthVerification
  //    with @@map + column @map matching the live tables
  ```

  Lists also gain a model-level `db.map` option, which emits a `@@map("...")` on the generated Prisma model so a list key can differ from its physical table name.

- [#502](https://github.com/OpenSaasAU/stack/pull/502) [`593390c`](https://github.com/OpenSaasAU/stack/commit/593390c57d9844ca7ada8f45b340c849f1d8d647) Thanks [@{](https://github.com/{)! - Add `authPlugin` schema placement so Auth lists can adopt an existing non-`public` better-auth layout (clean-diff adoption)

  The auth lists can now be placed in a non-`public` Postgres schema (e.g. `auth`) so they diff CLEAN against a separate-schema better-auth installation. A plugin-level `schema` option applies `@@schema(...)` to all generated Auth lists, with a per-list override.

  ```typescript
  authPlugin({
    schema: 'auth', // all Auth lists get @@schema("auth")
   modelName: 'AuthUser' },
    session: { modelName: 'AuthSession' },
    account: { modelName: 'AuthAccount' },
    // per-model override: relocate one list to a different schema
    verification: { modelName: 'AuthVerification', schema: 'auth_internal' },
  })
  ```

  The plugin's `beforeGenerate` hook wires the datasource `schemas` array (always including `public`) and defaults any list without an explicit `db.schema` to `public`, producing a valid multi-schema Prisma schema. With no `schema` option the output is unchanged (greenfield default stays in `public`, no `@@schema`).

  Core support added for this (mirroring the `db.map` → `@@map` work):
  - List-level `db.schema` → the Prisma generator emits `@@schema("...")` on the model.
  - Database-level `db.schemas` → the generator emits the datasource `schemas = [...]` array and enables the `multiSchema` preview feature.

  ```typescript
  // Core/generator building blocks
  db: { provider: 'postgresql', schemas: ['public', 'auth'] }
  AuthUser: list({ fields: { ... }, db: { map: 'AuthUser', schema: 'auth' } })
  // Generates: model AuthUser { ... @@map("AuthUser") @@schema("auth") }
  ```

### Patch Changes

- [#501](https://github.com/OpenSaasAU/stack/pull/501) [`e30f6a1`](https://github.com/OpenSaasAU/stack/commit/e30f6a1ef69dc65ae68b37539fa74c3f97823cfd) Thanks [@borisno2](https://github.com/borisno2)! - Keep `createdAt`/`updatedAt` on the auth lists now that auto-timestamps are off by default

  The derived auth lists (User/Session/Account/Verification) now opt into `db: { timestamps: true }`. better-auth's adapter writes those columns and the schema converter returns `null` for them assuming the generator injects them, so the opt-in keeps the generated auth models intact.

## 0.21.0

### Minor Changes

- [#415](https://github.com/OpenSaasAU/stack/pull/415) [`8980ff3`](https://github.com/OpenSaasAU/stack/commit/8980ff36ffb0879d8f4409740493dd940572cc9d) Thanks [@borisno2](https://github.com/borisno2)! - Curate the `@opensaas/stack-core` public surface into clearly-scoped entry points

  The root entry point now exposes only the everyday consumer surface — `config`,
  `list`, `getContext`, the naming helpers (`getDbKey`, `getUrlKey`,
  `getListKeyFromUrl`), `ValidationError`, and the config/access types you annotate
  with. Plugin and field authoring contracts move to a new `/extend` path, and the
  plumbing shared with sibling packages and generated code moves to `/internal`.

  ```typescript
  // Everyday usage (unchanged)
  import { config, list, getContext } from '@opensaas/stack-core'

  // Authoring a plugin or a third-party field package
  import type { Plugin, BaseFieldConfig, TypeInfo } from '@opensaas/stack-core/extend'
  ```

  `@opensaas/stack-core/internal` carries no semver guarantees; application code
  should never import from it. `Session` stays on the root entry point because it is
  the module-augmentation target.

  Removed from the public surface (zero callers): the nine `*HookArgs` types and the
  callerless typed-query runtime types. The other `@opensaas/*` packages and the CLI
  generator are updated to import from the new paths.

### Patch Changes

- [#414](https://github.com/OpenSaasAU/stack/pull/414) [`f03e5ac`](https://github.com/OpenSaasAU/stack/commit/f03e5ac32d5a38ef31c895b200b1a4f7a5e50c9c) Thanks [@borisno2](https://github.com/borisno2)! - Fix docs to use the canonical `authPlugin()`/`ragPlugin()` config pattern instead of the non-existent `withAuth()`/`authConfig()`/`withRAG()`/`ragConfig()` wrappers

## 0.20.1

## 0.20.0

### Patch Changes

- [#361](https://github.com/OpenSaasAU/stack/pull/361) [`6bf4254`](https://github.com/OpenSaasAU/stack/commit/6bf42546fa7f546fa6ecb5d89b586f02c61aacb4) Thanks [@borisno2](https://github.com/borisno2)! - Strip better-call validation error prefixes from SignUpForm error messages for user-friendly display

## 0.19.1

## 0.19.0

## 0.18.2

## 0.18.1

## 0.18.0

## 0.17.0

## 0.16.0

## 0.15.0

## 0.14.0

## 0.13.0

## 0.12.1

## 0.12.0

## 0.11.0

## 0.10.0

## 0.9.0

## 0.8.0

## 0.7.0

## 0.6.2

## 0.6.1

## 0.6.0

## 0.5.0

## 0.4.0

### Patch Changes

- [#172](https://github.com/OpenSaasAU/stack/pull/172) [`929a2a9`](https://github.com/OpenSaasAU/stack/commit/929a2a9a2dfa80b1d973d259dd87828d644ea58d) Thanks [@list<Lists.User.TypeInfo>({](https://github.com/list<Lists.User.TypeInfo>({), [@list<Lists.User.TypeInfo>({](https://github.com/list<Lists.User.TypeInfo>({)! - Improve TypeScript type inference for field configs and list-level hooks by automatically passing TypeInfo from list level down

  This change eliminates the need to manually specify type parameters on field builders when using features like virtual fields, and fixes a critical bug where list-level hooks weren't receiving properly typed parameters.

  ## Field Type Inference Improvements

  Previously, users had to write `virtual<Lists.User.TypeInfo>({...})` to get proper type inference. Now TypeScript automatically infers the correct types from the list-level type parameter.

  **Example:**

  ```typescript
  // Before

    fields: {
      displayName: virtual<Lists.User.TypeInfo>({
        type: 'string',
        hooks: {
          resolveOutput: ({ item }) => `${item.name} (${item.email})`,
        },
      }),
    },
  })

  // After

    fields: {
      displayName: virtual({
        type: 'string',
        hooks: {
          resolveOutput: ({ item }) => `${item.name} (${item.email})`,
        },
      }),
    },
  })
  ```

  ## List-Level Hooks Type Inference Fix

  Fixed a critical type parameter mismatch where `Hooks<TTypeInfo>` was passing the entire TypeInfo object as the first parameter instead of properly destructuring it into three required parameters:
  1. `TOutput` - The item type (what's stored in DB)
  2. `TCreateInput` - Prisma create input type
  3. `TUpdateInput` - Prisma update input type

  **Impact:**
  - `resolveInput` now receives proper Prisma input types (e.g., `PostCreateInput`, `PostUpdateInput`)
  - `validateInput` has access to properly typed input data
  - `beforeOperation` and `afterOperation` have correct item types
  - All list-level hook callbacks now get full IntelliSense and type checking

  **Example:**

  ```typescript
  Post: list<Lists.Post.TypeInfo>({
    fields: { title: text(), content: text() },
    hooks: {
      resolveInput: async ({ operation, resolvedData }) => {
        // ✅ resolvedData is now properly typed as PostCreateInput or PostUpdateInput
        // ✅ Full autocomplete for title, content, etc.
        if (operation === 'create') {
          console.log(resolvedData.title) // TypeScript knows this is string | undefined
        }
        return resolvedData
      },
      beforeOperation: async ({ operation, item }) => {
        // ✅ item is now properly typed as Post with all fields
        if (operation === 'update' && item) {
          console.log(item.title) // TypeScript knows this is string
          console.log(item.createdAt) // TypeScript knows this is Date
        }
      },
    },
  })
  ```

  ## Breaking Changes
  - Field types now accept full `TTypeInfo extends TypeInfo` instead of just `TItem`
  - `FieldsWithItemType` utility replaced with `FieldsWithTypeInfo`
  - All field builders updated to use new type signature
  - List-level hooks now receive properly typed parameters (may reveal existing type errors)

  ## Benefits
  - ✨ Cleaner code without manual type parameter repetition
  - 🎯 Better type inference in both field-level and list-level hooks
  - 🔄 Consistent type flow from list configuration down to individual fields
  - 🛡️ Maintained full type safety with improved DX
  - 💡 Full IntelliSense support in all hook callbacks

## 0.3.0

### Minor Changes

- [#133](https://github.com/OpenSaasAU/stack/pull/133) [`4ed7ba4`](https://github.com/OpenSaasAU/stack/commit/4ed7ba4ee4a08bacc76a40fc9f38a11fe0f00683) Thanks [@renovate](https://github.com/apps/renovate)! - Update to latest better-auth

## 0.2.0

### Minor Changes

- [#121](https://github.com/OpenSaasAU/stack/pull/121) [`3851a3c`](https://github.com/OpenSaasAU/stack/commit/3851a3cf72e78dc6f01a73c6fff97deca6fad043) Thanks [@borisno2](https://github.com/borisno2)! - Add strongly-typed session support via module augmentation

  This change enables developers to define custom session types with full TypeScript autocomplete and type safety throughout their OpenSaas applications using the module augmentation pattern.

  **Core Changes:**
  - Converted `Session` from `type` to `interface` to enable module augmentation
  - Updated all session references to properly handle `Session | null`
  - Added comprehensive JSDoc documentation with module augmentation examples
  - Updated `AccessControl`, `AccessContext`, and access control engine to support nullable sessions
  - Added "Session Typing" section to core package documentation

  **Auth Package:**
  - Added "Session Type Safety" section to documentation
  - Documented how Better Auth users can create session type declarations
  - Provided step-by-step guide for matching sessionFields to TypeScript types
  - Created `getSession()` helper pattern for transforming Better Auth sessions

  **Developer Experience:**

  Developers can now augment the `Session` interface to get autocomplete everywhere:

  ```typescript
  // types/session.d.ts
  import '@opensaas/stack-core'

  declare module '@opensaas/stack-core' {
    interface Session {
      userId?: string
      email?: string
      role?: 'admin' | 'user'
    }
  }
  ```

  This provides autocomplete in:
  - Access control functions
  - Hooks (resolveInput, validateInput, etc.)
  - Context object
  - Server actions

  **Benefits:**
  - Zero boilerplate - module augmentation provides types everywhere automatically
  - Full type safety for session properties
  - Autocomplete in all contexts that use session
  - Developer controls session shape (no assumptions about structure)
  - Works with any auth provider (Better Auth, custom, etc.)
  - Fully backward compatible - existing code continues to work
  - Follows TypeScript best practices (similar to NextAuth.js pattern)

  **Example:**

  ```typescript
  // Before: No autocomplete
  const isAdmin: AccessControl = ({ session }) => {
    return session?.role === 'admin' // ❌ 'role' is 'unknown'
  }

  // After: Full autocomplete and type checking
  const isAdmin: AccessControl = ({ session }) => {
    return session?.role === 'admin' // ✅ Autocomplete + type checking
    //             ↑ Shows: userId, email, role
  }
  ```

  **Migration:**

  No migration required - this is a fully backward compatible change. Existing projects continue to work with untyped sessions. Projects can opt-in to typed sessions by creating a `types/session.d.ts` file with module augmentation.

### Patch Changes

- [#107](https://github.com/OpenSaasAU/stack/pull/107) [`f4f3966`](https://github.com/OpenSaasAU/stack/commit/f4f3966faedba07d2cf412fab826d81e30c63a6c) Thanks [@borisno2](https://github.com/borisno2)! - Add strict typing for plugin runtime services

  This change implements fully typed plugin runtime services, providing autocomplete and type safety for `context.plugins` throughout the codebase.

  **Core Changes:**
  - Extended `Plugin` type with optional `runtimeServiceTypes` metadata for type-safe code generation
  - Converted `OpenSaasConfig` and `AccessContext` from `type` to `interface` to enable module augmentation
  - Plugins can now declare their runtime service type information

  **Auth Plugin:**
  - Added `AuthRuntimeServices` interface defining runtime service types
  - Exported runtime types from package
  - Users now get full autocomplete for `context.plugins.auth.getUser()` and `context.plugins.auth.getCurrentUser()`

  **RAG Plugin:**
  - Added `RAGRuntimeServices` interface defining runtime service types
  - Exported runtime types from package
  - Users now get full autocomplete for `context.plugins.rag.generateEmbedding()` and `context.plugins.rag.generateEmbeddings()`

  **CLI Generator:**
  - Enhanced plugin types generator to import and use plugin runtime service types
  - Generated `.opensaas/plugin-types.ts` now includes proper type imports
  - `PluginServices` interface extends `Record<string, Record<string, any> | undefined>` for type compatibility
  - Maintains backwards compatibility with plugins that don't provide type metadata

  **UI Package:**
  - Updated `AdminUI` props to accept contexts with typed plugin services
  - Ensures compatibility between generated context types and UI components

  **Benefits:**
  - Full TypeScript autocomplete for all plugin runtime methods
  - Compile-time type checking catches errors early
  - Better IDE experience with hover documentation and jump-to-definition
  - Backwards compatible - third-party plugins without type metadata continue to work
  - Zero type errors in examples

  **Example:**

  ```typescript
  const context = await getContext()

  // Fully typed with autocomplete
  context.plugins.auth.getUser('123') // (userId: string) => Promise<unknown>
  context.plugins.rag.generateEmbedding('text') // (text: string, providerName?: string) => Promise<number[]>
  ```

## 0.1.7

### Patch Changes

- Updated dependencies [372d467]
  - @opensaas/stack-core@0.1.7

## 0.1.6

### Patch Changes

- 39996ca: Add plugin mechanism
- Updated dependencies [39996ca]
- Updated dependencies [39996ca]
  - @opensaas/stack-core@0.1.6

## 0.1.5

### Patch Changes

- 17eaafb: Update package urls
- Updated dependencies [17eaafb]
  - @opensaas/stack-core@0.1.5

## 0.1.4

### Patch Changes

- d013859: **BREAKING CHANGE**: Migrate MCP functionality into core and auth packages

  The `@opensaas/stack-mcp` package has been deprecated and its functionality has been split into:
  - `@opensaas/stack-core/mcp` - Auth-agnostic MCP runtime and handlers
  - `@opensaas/stack-auth/mcp` - Better Auth OAuth adapter

  **Migration required:**

  ```typescript
  // Before
  import { createMcpHandlers } from '@opensaas/stack-mcp'
  const { GET, POST, DELETE } = createMcpHandlers({ config, auth, getContext })

  // After
  import { createMcpHandlers } from '@opensaas/stack-core/mcp'
  import { createBetterAuthMcpAdapter } from '@opensaas/stack-auth/mcp'
  const { GET, POST, DELETE } = createMcpHandlers({
    config,
    getSession: createBetterAuthMcpAdapter(auth),
    getContext,
  })
  ```

  **Why this change?**
  - Reduces package count in the monorepo
  - Core package handles auth-agnostic MCP protocol
  - Auth package provides Better Auth specific adapter
  - Better-auth is no longer a dependency of core
  - Enables support for custom auth providers beyond Better Auth

  **New features:**
  - `McpSessionProvider` type for custom auth integration
  - More generic `McpAuthConfig` type supporting custom auth providers
  - Core MCP functionality available without auth dependencies

- Updated dependencies [d013859]
  - @opensaas/stack-core@0.1.4

## 0.1.3

### Patch Changes

- @opensaas/stack-core@0.1.3

## 0.1.2

### Patch Changes

- @opensaas/stack-core@0.1.2

## 0.1.1

### Patch Changes

- f8ebc0e: Add base mcp server
- Updated dependencies [9a3fda5]
- Updated dependencies [f8ebc0e]
- Updated dependencies [045c071]
  - @opensaas/stack-core@0.1.1
