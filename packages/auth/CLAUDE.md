# @opensaas/stack-auth

Better-auth integration for OpenSaas Stack providing authentication, session management, and pre-built UI components.

## Purpose

Adds complete authentication to OpenSaas Stack apps with minimal configuration. Wraps Better-auth to provide:

- Auto-generated auth tables (User, Session, Account, Verification)
- Automatic session integration with access control
- Pre-built UI components (sign in, sign up, password reset)
- OAuth provider support (GitHub, Google, etc.)

## Key Files & Exports

### Config (`src/config/plugin.ts`)

- `authPlugin({ ... })` - Plugin added to a config's `plugins` array; merges auth lists, configures Better-auth plugins and session. This is the only configuration entry point.

### Lists (`src/lists/index.ts`)

Auto-generated lists:

- `User` - Core user model (email, name, emailVerified, image)
- `Session` - Active sessions (token, expiresAt, ipAddress, userAgent)
- `Account` - OAuth accounts (providerId, accessToken, refreshToken, password)
- `Verification` - Email verification tokens

### Server (`src/server/index.ts`)

- `createAuth(config, rawContext?, betterAuthPlugins?)` - Creates Better-auth instance with MCP plugin support
- `buildBetterAuthOptions(config, rawContext?, betterAuthPlugins?)` - Returns the same `BetterAuthOptions` `createAuth()` builds, without constructing an instance — for apps that need to hand-wire their own `betterAuth()`. The optional third argument (the app's own `betterAuthPlugins` array) makes the return type carry that literal plugin tuple instead of the widened array type — see "Typed `auth.api.*` reads" below.
- Returns `{ handler, signIn, signOut, ... }` - Better-auth methods

### Client (`src/client/index.ts`)

- `createClient({ baseURL })` - Better-auth client for React hooks
- Returns hooks: `useSession()`, `signIn()`, `signOut()`, etc.

### UI (`src/ui/index.ts`)

Pre-built forms (client components). Each takes **server action** props (not an
`authClient`) — see "Auth forms submit through server actions" below and ADR-0020:

- `SignInForm` - Email/password + OAuth sign in
- `SignUpForm` - Create account with password confirmation
- `ForgotPasswordForm` - Request password reset email
- `ResetPasswordForm` - Set a new password from a reset-email token

### Plugins (`src/plugins/index.ts`)

- Better-auth MCP plugin for OAuth authentication with AI assistants

## Architecture Patterns

### Config Merging

`authPlugin()` merges auth lists into your config:

```typescript
config({
  lists: { Post: list({...}) },
  plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
})
// Result: { lists: { User, Session, Account, Verification, Post } }
```

### Deriving Auth lists from better-auth config

The four Auth lists are **derived** from the better-auth model config the
developer writes — not hardcoded. The pure derivation lives in
`src/config/derive-auth-lists.ts` (`deriveAuthLists`), which `getAuthLists`
and the plugin's add-vs-extend logic consume:

- per-model `modelName` → list key (and Prisma model name)
- per-model `tableName` → table `@@map`, **independent of `modelName`**
  (defaults to `modelName` when it differs from the better-auth default,
  otherwise unset — i.e. unchanged output when `tableName` isn't set)
- per-model `fields` (better-auth field → column) → field-level `@map`
- the `userId` column override → the `user` relationship foreign-key `@map`
- relationship refs between the Auth lists follow the derived keys
  (e.g. `Session.user → AuthUser.sessions`)

With no `modelName`/`tableName`/`fields` overrides the output is unchanged
(`User`/`Session`/`Account`/`Verification`, original field shapes, no `@@map`).

```typescript
// Adopt an existing better-auth installation (Auth lists ≠ app User)
authPlugin({
  user: { modelName: 'AuthUser', fields: { name: 'full_name' } },
  session: { modelName: 'AuthSession', fields: { userId: 'user_id' } },
})
// Adds AuthUser/AuthSession/... and leaves an app's own `User` untouched.
```

```typescript
// modelName sets the list key; tableName independently pins the live table —
// e.g. a prefixed list key adopting better-auth's own default lowercase table.
authPlugin({
  user: { modelName: 'AuthUser', tableName: 'user' },
  session: { modelName: 'AuthSession', tableName: 'session' },
})
```

Because the plugin only ever adds/extends its **derived** keys, an app's own
domain `User` (a different model from the better-auth user) is never extended
or overwritten when the user model is renamed. The runtime `getUser`/
`getCurrentUser` helpers resolve the user list's `context.db` key from the
configured user `modelName`, and read through the `sudo` argument passed to
`runtime(context, sudo)` (see below).

### Access control on Auth lists (ADR-0013)

The four Auth lists ship **closed** — no operation-level access — per
[ADR-0013](../../docs/adr/0013-access-control-belongs-to-the-application-not-plugins.md).
Grant access via `authPlugin({ access: { user, session, account, verification } })`,
keyed by better-auth model name (not the derived list key, so it survives a
`modelName` remap). Each entry is applied on the plugin's own `addList` path
in `deriveAuthLists` (`src/config/derive-auth-lists.ts`), so it rides along
with the list's `@@map`/`@@schema`/fields — it is **not** forwarded on the
`extendList` path (an app-declared list of the same key keeps its own
access, unchanged since #678/ADR-0013).

`extendUserList.access` (the pre-existing User-only override) still works and
takes precedence over `access.user` when both are set — `createUserList` in
`derive-auth-lists.ts` resolves `userConfig.access || accessConfig.user`.

better-auth's own sign-in/sign-up/session flows are unaffected: they write
through the raw Prisma client (the driver adapter), bypassing access control
entirely. The runtime `getUser`/`getCurrentUser` helpers resolve through the
`sudo` argument core passes to `plugin.runtime(context, sudo)` for the same
reason — "who is this session" must not depend on the application's User
access policy. `sudo` is a plain second argument, not a method on `context`
(`AccessContext`) itself — see `packages/core/CLAUDE.md`.

`convertBetterAuthSchema`/`convertTableToList` (`src/server/schema-converter.ts`),
which handle additional tables a better-auth plugin's own schema declares
(e.g. OAuth client tables from the `mcp` plugin), also ship closed — there is
no `access` passthrough for them; an app that needs to grant access declares
the list itself under the same derived key so the plugin's field-only extend
path merges in (its own access then stands, same as any other `extendList`).

### Schema placement (relocatable Auth lists)

A plugin-level `schema` option places all generated Auth lists in a non-`public`
Postgres schema via `@@schema(...)`, so they can adopt a separate-schema
better-auth layout (e.g. an `auth` schema) and reach **Schema parity** with the
live tables. Combined with the derived keys/`@@map`/field `@map`s above, the
generated lists diff CLEAN against an existing `auth`-schema install — they are
modelled for runtime/types without producing a migration.

```typescript
authPlugin({
  schema: 'auth', // all Auth lists get @@schema("auth")
  user: { modelName: 'AuthUser' },
  session: { modelName: 'AuthSession' },
  account: { modelName: 'AuthAccount' },
  verification: { modelName: 'AuthVerification' },
  // per-model override: relocate one list to a different schema
  // verification: { modelName: 'AuthVerification', schema: 'auth_internal' },
})
```

How it wires up (Postgres multi-schema):

- Each Auth list gets a list-level `db.schema` → `@@schema(...)` (per-model
  `schema` override, else the plugin-level `schema`).
- The plugin's `beforeGenerate` hook adds the auth schema(s) (always plus
  `public`) to the datasource `db.schemas` array and defaults any list without
  an explicit `db.schema` to `public`, so the generated multi-schema Prisma
  schema is valid (the generator emits `previewFeatures = ["multiSchema"]` and
  `schemas = [...]`).
- With no `schema` option the Auth lists stay in `public` and no `@@schema` /
  `schemas` / preview feature is emitted (greenfield default unchanged).

### Adopting an existing better-auth install (`adoptBetterAuthTables`)

`adoptBetterAuthTables()` (`src/config/adopt-better-auth-tables.ts`) is a thin
recipe that returns the `AuthConfig` adoption knobs — the plugin-level `schema`
plus a per-model `modelName` (and optional column `fields`/`tableName` maps) —
preset to the conventions of a standard separate-schema better-auth install. It
ties together the keys/field derivation and schema placement so a migrator
doesn't rebuild the config by hand. Spread it into `authPlugin`:

```typescript
import { authPlugin, adoptBetterAuthTables } from '@opensaas/stack-auth'

authPlugin({
  ...adoptBetterAuthTables(), // schema: 'auth', AuthUser/AuthSession/AuthAccount/AuthVerification
  emailAndPassword: { enabled: true },
})
// Options: adoptBetterAuthTables({ schema, modelNamePrefix, fields, useBetterAuthTableNames, tableNames })
```

The most common adoption shape is a project that ran better-auth **before**
Stack, so its live tables are still better-auth's own default lowercase names
(`user`/`session`/`account`/`verification`) even though the derived list keys
need an `Auth` prefix to avoid colliding with the app's own domain `User`.
`useBetterAuthTableNames: true` sets every model's `tableName` to that
default; the per-model `tableNames` map is the escape hatch for a mix (it
wins over `useBetterAuthTableNames` for any model it names):

```typescript
authPlugin({
  ...adoptBetterAuthTables({ useBetterAuthTableNames: true }),
  // → AuthUser/AuthSession/AuthAccount/AuthVerification list keys,
  //   @@map("user")/@@map("session")/@@map("account")/@@map("verification")
})
```

It is pure config (no side effects): everything it sets can also be written
directly on `authPlugin`, and spreading it before your own keys lets you
override per model. Because the derived user key is `AuthUser` (not `User`), an
app's own domain `User` is left untouched — the plugin only ever adds/extends
its derived keys. Combined with the derivation + schema placement above, the
generated Auth lists reach **Schema parity** (clean `schema:diff`) against a live
`auth`-schema install — they are modelled for runtime/types, not migrated.

**App User ≠ Auth identity.** The plugin models the **Auth identity** (the
better-auth user); it does not assume that list is the app's domain `User`.
Linking an app's `User` to the Auth identity (e.g. a `relationship({ ref:
'AuthUser' })` the app declares) is the application's concern. See the
[Authentication guide](../../docs/content/guides/authentication.md) (“Adopting an
existing better-auth installation”) for the end-to-end migrator walkthrough.

### Session Provider

Better-auth provides session to context via custom `prismaClientConstructor`:

```typescript
// Generated .opensaas/context.ts uses this pattern:
const session = await auth.api.getSession({ headers })
const context = createContext(config, prisma, session)
```

### Session Fields Configuration

Control which User fields appear in session:

```typescript
authPlugin({ sessionFields: ['userId', 'email', 'name', 'role'] })
// Access in access control:
access: {
  operation: {
    create: ({ session }) => session?.role === 'admin'
  }
}
```

### Session Type Safety

To get autocomplete and type safety for session fields, use module augmentation:

**Step 1: Create session type declaration file**

```typescript
// types/session.d.ts
import '@opensaas/stack-core'

declare module '@opensaas/stack-core' {
  interface Session {
    userId: string
    email: string
    name: string
    role: 'admin' | 'user'
  }
}
```

**Step 2: Ensure fields match your sessionFields configuration**

```typescript
authPlugin({
  sessionFields: ['userId', 'email', 'name', 'role'],
  extendUserList: {
    fields: {
      role: select({
        options: [
          { label: 'Admin', value: 'admin' },
          { label: 'User', value: 'user' },
        ],
        defaultValue: 'user',
      }),
    },
  },
})
```

**Result: Fully typed session everywhere**

```typescript
const isAdmin: AccessControl = ({ session }) => {
  return session?.role === 'admin' // ✅ Autocomplete and type checking
  //             ↑ Shows: userId, email, name, role
}

const context = await getContext(session)
if (context.session?.email) {
  // ✅ Type: string
  // Send email...
}
```

**Important Notes:**

- Session type declaration must match your `sessionFields` configuration
- `userId` always maps to User's `id` field
- Add fields to `extendUserList` before including them in session
- The session type is independent of Better Auth's internal types

### Extending User List

Add custom fields to User:

```typescript
authPlugin({
  extendUserList: {
    fields: {
      role: select({ options: [{ label: 'User', value: 'user' }] }),
      company: text(),
    },
  },
})
```

### Escape hatch for unmodelled better-auth options (`betterAuthOptions`)

`AuthConfig` models a deliberately closed set of better-auth options. For
anything the stack doesn't model — database hooks, `session.cookieCache`,
`baseURL`, `verification.storeIdentifier`, and so on — pass it through
`betterAuthOptions`, typed as better-auth's own `BetterAuthOptions` so it
tracks better-auth's surface without the stack re-declaring it:

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

`createAuth()` (`src/server/index.ts`) deep-merges `betterAuthOptions` onto
the options it builds from the rest of `AuthConfig`, applied **last**:
plain-object values merge recursively per key (so `session: { cookieCache }`
lands alongside the stack's own `session.expiresIn`/`updateAge` instead of
replacing the whole `session` block), arrays and other value types replace
outright, and `betterAuthOptions` wins on any genuine key collision. The
merge and the option-building it merges onto both live in
`buildBetterAuthOptions()`, the single place `createAuth()` and the exported
builder share — they cannot drift from each other because `createAuth()`
calls it directly rather than reimplementing it.

`database` and `plugins` are rejected outright (`assertNoUnsupportedPassthroughKeys`
in `src/server/index.ts`): they already have dedicated seams (`db` in the
stack config, and `betterAuthPlugins` respectively), and accepting them here
would create two unranked ways to set the same thing — worse for `plugins`,
since the stack must append `nextCookies()` last (see "Auth forms submit
through server actions" below). `additionalFields` under `user`/`session`/
`account`/`verification` is rejected too — it adds columns with no
corresponding change to the generated Prisma schema, which is exactly the
silent-divergence failure mode this passthrough exists to avoid elsewhere.
Add fields to the derived list instead: `extendUserList` for the user model,
or declare the list yourself in your own `lists` config for the others (the
auth plugin's `addList`-vs-`extendList` logic — see "Deriving Auth lists from
better-auth config" above — merges in field additions for any list matching
one of its derived keys).

### Hand-wiring `betterAuth()` from the stack config (`buildBetterAuthOptions`)

An app that needs a resolved `betterAuth()` instance at module-init time
(rather than `createAuth()`'s lazy proxy) can derive its options from the
stack config instead of duplicating them:

```typescript
import { betterAuth } from 'better-auth'
import { buildBetterAuthOptions } from '@opensaas/stack-auth/server'

export const auth = betterAuth({
  ...(await buildBetterAuthOptions(config, rawOpensaasContext)),
  databaseHooks: { user: { create: { after: syncDomainUser } } }, // not yet in betterAuthOptions
})
```

This is the same async-resolve-then-construct step `createAuth()` performs
internally, exported standalone — see ADR-0014 and root `CLAUDE.md`'s
"Getting the ORM client outside a request" for why `createAuth()` itself
can't be synchronous. It gives an incremental path onto `createAuth()`: adopt
the builder first, then fold options into `betterAuthOptions` above as the
stack grows first-class config for them.

**Typed `auth.api.*` reads.** Called with just `(config, context)`, both
`buildBetterAuthOptions()` and `createAuth()` return the widened
`BetterAuthOptions` / `Auth<BetterAuthOptions>` — better-auth infers plugin
endpoints and a `customSession()`'s replaced session shape from the _literal_
options type, so the widened form erases them (an `emailOTP()` plugin loses
`auth.api.signInEmailOTP`; `auth.api.getSession()` falls back to `{ user,
session }` instead of a `customSession()` shape). Both functions take the
app's `betterAuthPlugins` array — the exact same array passed to
`authPlugin({ betterAuthPlugins })` — as an optional third argument, and their
return type then carries that literal tuple (plus the `nextCookies()` the
stack always appends last) instead of the widened array type:

```typescript
export const appBetterAuthPlugins = [emailOTP({ sendVerificationOTP })] // same array passed to authPlugin({ betterAuthPlugins })

export const auth = betterAuth({
  ...(await buildBetterAuthOptions(config, rawOpensaasContext, appBetterAuthPlugins)),
})
// auth.api.signInEmailOTP is now typed.
```

The supplied tuple is for typing only — the plugin array used at runtime is
always the one resolved from `authPlugin({ betterAuthPlugins })` — so both
functions verify the supplied tuple is the same plugin instances in the same
order as the resolved array, throwing a prefixed error naming the mismatch if
not (`assertPluginTupleMatchesResolved` in `src/server/index.ts`). This is
what closes the drift hole a hand-rolled re-pass of the plugin array would
otherwise open.

`createAuth()`'s lazy `Proxy` does not behave identically to a real `Auth`
instance for every property regardless of which form you use — every access,
including a non-function property, is surfaced through an `async` wrapper (so
`auth.options` reads back as a `Promise`, not the plain object a real
instance returns synchronously). Reach for `buildBetterAuthOptions()` plus
`betterAuth()` instead when the app reads `auth.api.*` in typed code — it
constructs a real instance and does not have this gap.

## Integration Points

### With @opensaas/stack-core

- Merges auth lists into core config
- Session flows through context to all access control functions
- Generator creates Prisma schema with auth tables

### With MCP (Model Context Protocol)

- Auth provides Better Auth MCP adapter via `@opensaas/stack-auth/mcp`
- MCP plugin enables OAuth for AI assistants
- `createBetterAuthMcpAdapter()` converts Better Auth instance to session provider
- Works with core MCP runtime from `@opensaas/stack-core/mcp`
- Requires `rawOpensaasContext` from `.opensaas/context.ts`:

```typescript
import { rawOpensaasContext } from '@/.opensaas/context'
export const auth = createAuth(config, rawOpensaasContext)
```

`createAuth()` returns a `Proxy` synchronously and defers the real `betterAuth()` construction (and the `context.prisma` it wraps) until `rawOpensaasContext` resolves — the sanctioned pattern for a module-init-time consumer that only needs to defer method calls, not obtain a resolved client value. See ADR-0014 and root `CLAUDE.md`'s "Getting the ORM client outside a request" for the full decision record and the synchronous-client alternative.

### With Better-auth

- Direct wrapper around Better-auth core
- Uses Better-auth's plugin system (MCP, OAuth providers)
- Schema converter maps OpenSaas lists to Better-auth schema format

## Common Patterns

### Basic Setup

```typescript
// 1. Config
export default config({
  db: {...},
  lists: {...},
  plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
})

// 2. Server (lib/auth.ts)
export const auth = createAuth(config, rawOpensaasContext)

// 3. Route (app/api/auth/[...all]/route.ts)
export { GET, POST } from '@/lib/auth'

// 4. Server actions (lib/actions/auth.ts) — the forms submit through these
'use server'
import { auth } from '@/lib/auth'
import type { AuthActionResult, SignInInput } from '@opensaas/stack-auth/ui'
export async function signInAction(input: SignInInput): Promise<AuthActionResult> {
  try {
    await auth.api.signInEmail({ body: input, headers: await headers() })
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Sign in failed' }
  }
}

// 5. UI (app/sign-in/page.tsx)
<SignInForm signInAction={signInAction} redirectTo="/admin" />
```

### Auth forms submit through server actions

The pre-built forms take app-owned `'use server'` action props instead of a browser
`authClient`, so the auth network surface stays server-side (no `/api/auth/*` call from
the browser). `createAuth` auto-adds better-auth's `nextCookies` plugin (as the last
plugin) so a session cookie set inside a server action persists. The action props are:

- `SignInForm`: `signInAction`, optional `signInSocialAction`
- `SignUpForm`: `signUpAction`, optional `signInSocialAction`
- `ForgotPasswordForm`: `requestPasswordResetAction`
- `ResetPasswordForm`: `resetPasswordAction` + a `token` prop (the page reads it from
  `searchParams.token`)

Email actions return `AuthActionResult` and the form redirects client-side; social
sign-in redirects server-side to the provider. The package exports the contract types
(`AuthActionResult`, `SignInInput`, `SignUpInput`, `RequestPasswordResetInput`,
`ResetPasswordInput`, and the action aliases). `createClient` is unchanged for
client-side session reading (`useSession`). See ADR-0020 and `examples/starter-auth`.

### Access Control with Session

```typescript
Post: list({
  access: {
    operation: {
      create: ({ session }) => !!session,
      update: ({ session, item }) => session?.userId === item.authorId,
    },
    fields: {
      internalNotes: {
        read: ({ session }) => session?.role === 'admin',
      },
    },
  },
})
```

### OAuth Providers

```typescript
authPlugin({
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!
    }
  }
})

// UI — pass the redirecting social action to enable the provider buttons
<SignInForm
  signInAction={signInAction}
  signInSocialAction={signInSocialAction}
  socialProviders={['github', 'google']}
/>
```

## Type Safety

Session type is inferred from `sessionFields`:

```typescript
authPlugin({ sessionFields: ['userId', 'email', 'role'] })
// session: { userId: string, email: string, role: string } | null
```

All auth operations use Better-auth's type-safe client.
