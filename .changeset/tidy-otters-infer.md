---
'@opensaas/stack-auth': minor
---

`buildBetterAuthOptions()` and `createAuth()` now accept an optional third argument — your app's `betterAuthPlugins` array, the same array passed to `authPlugin({ betterAuthPlugins })` — so the returned options/`Auth` type carries the literal plugin tuple instead of the widened `BetterAuthOptions`/`Auth<BetterAuthOptions>`. Without this, `betterAuth()` constructed from the widened return loses plugin-derived `auth.api.*` endpoints (e.g. `emailOTP()`'s `signInEmailOTP`) and a `customSession()` plugin's replaced session shape.

```typescript
export const appBetterAuthPlugins = [emailOTP({ sendVerificationOTP })] // same array passed to authPlugin({ betterAuthPlugins })

export const auth = betterAuth({
  ...(await buildBetterAuthOptions(config, rawOpensaasContext, appBetterAuthPlugins)),
})
// auth.api.signInEmailOTP is now typed, and auth.api.getSession() returns your customSession() shape.
```

The supplied tuple is for typing only — the plugin array used at runtime is always the one resolved from `authPlugin({ betterAuthPlugins })`. Passing a tuple that isn't the same plugin instances in the same order throws, naming the mismatch, so the two can't silently drift apart. Calling either function with no third argument is unchanged — same widened return type, same runtime options, fully backwards compatible.

Also, `AuthConfig`/`NormalizedAuthConfig`'s `betterAuthPlugins` field is now typed as better-auth's own `BetterAuthPlugin[]` instead of `any[]`.
