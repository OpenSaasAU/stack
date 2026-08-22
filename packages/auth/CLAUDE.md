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

- `mcp` - re-exported from the optional `@better-auth/mcp` peer (better-auth
  1.7 split it out of `better-auth/plugins`) for OAuth authentication with AI
  assistants. Its `resource` option (the RFC 8707/9728 canonical
  protected-resource URL) and `consentPage` (where a user approves/denies an
  MCP client's requested scopes) are both required as of that split, and it
  now needs better-auth's own `jwt()` plugin (from `better-auth/plugins`,
  unaffected by the `@better-auth/mcp` split) registered alongside it — the
  OAuth Provider `mcp()` is built on issues JWT-based access tokens and
  throws `BetterAuthError: jwt_config` at init without it. See the
  `betterAuthPlugins` example in the root `CLAUDE.md`'s MCP section.

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

The four Auth lists, the conditional `RateLimit` fifth, and every table a
better-auth plugin declares in its own `schema` (e.g. the `mcp` plugin's
`oauthClient`/`oauthAccessToken`/`oauthConsent`/`oauthRefreshToken`/
`oauthResource`/`oauthClientResource`/`oauthClientAssertion` — better-auth
1.7 split the plugin into `@better-auth/mcp` and rebuilt it on the OAuth
Provider RFC 8707/9728 resource model, a wider table set than the pre-1.7
`oauthApplication`/`oauthAccessToken`/`oauthConsent` three) are all **derived**
from better-auth's own resolved table definitions, not hand-transcribed. The
pure derivation lives in `src/config/derive-auth-lists.ts` (`deriveAuthLists`),
which `getAuthLists` and the plugin's `init` consume. It calls `getAuthTables`
(re-exported from `better-auth/db` — the same function better-auth's own
Kysely migrator, schema generator, and adapter base use to build their
schemas), passing the app's `betterAuthPlugins` through as `options.plugins`
so a plugin's own schema (a standalone table, or a schema extension of a base
model like the `anonymous` plugin's `user.isAnonymous`) is already merged
into the result — and translates it into stack list configs, so the Auth
lists cannot silently drift from what better-auth itself declares (issue
#987, ADR-0033, ADR-0034):

- per-model `modelName`/`fields` (the developer's own `authPlugin({ user:
{...}, session: {...} })` config, already normalized) pass straight
  through to `getAuthTables` as its own options object, so an override path
  (`adoptBetterAuthTables`, a renamed model, a remapped column) is inherited
  for free rather than re-implemented as a parallel normalization
- `modelName` → list key (and Prisma model name); `tableName` → table
  `@@map`, **independent of `modelName`** (defaults to `modelName` when it
  differs from the better-auth default, otherwise unset — i.e. unchanged
  output when `tableName` isn't set)
- every scalar field's type, nullability, uniqueness, index, column map, and
  static default value are read from better-auth's own field metadata (a
  fixed type-mapping table: `string`→`text()`, `boolean`→`checkbox()`,
  `date`→`timestamp()`, `number`→`integer()`/`bigInt()` depending on
  better-auth's own `bigint` flag) — not hand-authored per field
- the `user` relationship foreign key maps to better-auth's own resolved
  column name (`userId` by default; an explicit `fields.userId` override
  takes precedence), and its index/uniqueness and `onDelete` action are read
  from better-auth's own `index`/`unique`/`references.onDelete`, matching a
  live better-auth database on all three dimensions (ADR-0007, ADR-0033)
- relationship refs between the Auth lists follow the derived keys
  (e.g. `Session.user → AuthUser.sessions`) — the reverse relation name
  itself (`sessions`/`accounts`) has no source in better-auth's metadata
  (its FK declaration is one-directional) and is derived by pluralizing the
  child model's own key, with a documented override map in
  `derive-auth-lists.ts` for a collision or bad pluralization
- a **plugin table**'s list key is PascalCased from better-auth's resolved
  `modelName` (`oauthClient` → `OauthClient`), with `db.map` set
  back to the original whenever the case changed; its scalar/FK fields go
  through the exact same derivation as a base model's, including the reverse
  relation onto whichever list it references (base or another plugin table).
  A reference whose target field isn't the target's `id` (better-auth's own
  oidc-provider schema does this — `oauthAccessToken.clientId` references
  `oauthClient.clientId`, not its `id`) stays a plain scalar column,
  since `relationship()` can only express an `id`-based FK. Plugin tables
  ship closed like the base models, with no `access` passthrough at all —
  see ADR-0034 and "Access control on Auth lists" below

With no `modelName`/`tableName`/`fields` overrides the base list/table shape
is otherwise unchanged (`User`/`Session`/`Account`/`Verification`, original
field shapes, no table `@@map`).

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

Better-auth plugin tables (e.g. OAuth client tables from the `mcp` plugin)
are derived by the same `deriveAuthLists` — not a separate converter, since
ADR-0034 — and also ship closed: there is no `access` passthrough for them;
an app that needs to grant access declares the list itself under the same
derived key so the plugin's field-only extend path merges in (its own access
then stands, same as any other `extendList`).

### Credential fields are read-denied independent of operation access (ADR-0036)

Operation-level access is all-or-nothing at the list, not the column — so
the deny above (list-level) isn't the whole story for the six
credential-bearing fields (`Session.token`, `Verification.value`,
`Account.password`/`accessToken`/`refreshToken`/`idToken`): `deriveAuthLists`
sets a field-level `access: { read: () => false }` on each of them
unconditionally, independent of whatever `accessConfig` an app supplies.
Opening `query` on `Session` for a "your active sessions" screen no longer
also exposes `token` — the field is stripped from a returned row (the
ordinary field-access-denial behavior), the row itself still returns. This
holds even for a `findUnique` lookup that selects the row BY the denied
field (`context.db.session.findUnique({ where: { token } })` still finds
the session; `token` just comes back stripped) — `findUnique`'s `where` is
a unique selector, not a predicate the read-access check walks. Naming the
field in `findMany`'s (or `count`'s) `where`/`orderBy` instead takes the
predicate-time path (`validateQueryFieldReadAccess` in
`packages/core/src/access/query-validation.ts`) and throws a
`ValidationError` up front rather than stripping anything; `sudo()` is
required for that shape too, not only for reading the column back off a
row fetched another way.

The deny is applied in the scalar-field derivation loop
(`withCredentialAccess` in `derive-auth-lists.ts`), keyed by better-auth's
own model/field key (`CREDENTIAL_FIELDS`) — not the app's list key or
column `db.map` — so it survives a `modelName` remap or a `fields` column
override. `sudo()` still reads these fields either way, unaffected: this is
the supported path for a genuine need (an admin tool, or an app's own auth
code verifying a password hash via `HashedPassword.compare()`). See
`packages/core/CLAUDE.md`'s "Access Control Execution Flow" for how a
field-level `read` denial is enforced, and ADR-0036 for why this list is
exactly these six fields and not, say, `Account.providerId` or
`Session.ipAddress` (identifying, not authenticating — left open).

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

`sessionFields` describes a **flattened projection** of the resolved better-auth session, not
the session's own shape:

```typescript
authPlugin({ sessionFields: ['userId', 'email', 'name', 'role'] })
// Access in access control:
access: {
  operation: {
    create: ({ session }) => session?.role === 'admin'
  }
}
```

`getSessionFromAuth()` (`@opensaas/stack-auth/server`) is the single implementation of this
projection — the scaffolded `getSession()` calls it with `sessionFields` read from the resolved
config at runtime. Each name resolves against a fixed precedence (a top-level key on the
resolved session, then `user`, then `session`), with `userId` special-cased to the user's `id`.
A `customSession` better-auth plugin fully replaces the resolved shape and can nest fields
anywhere; reconciling that against `sessionFields` is the app's job — an unresolvable name is
omitted and warns once (per field, per process) rather than silently becoming `undefined`. See
the `sessionFields` reference (`docs/content/reference/auth.md`) for the full contract.

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
