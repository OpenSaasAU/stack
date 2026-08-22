---
'@opensaas/stack-auth': minor
---

Extend the ADR-0036 credential field read-deny from the four base Auth models to better-auth plugin tables, and add a `credentialFields` config option for plugins the stack doesn't seed a set for.

The following fields now ship field-level `read`-denied, on top of the existing `Session.token`/`Verification.value`/`Account.password`/`accessToken`/`refreshToken`/`idToken`:

- `oauthClient.clientSecret`, `oauthAccessToken.token`, `oauthRefreshToken.token` (the `mcp`/oauth-provider plugin)
- `twoFactor.secret`, `twoFactor.backupCodes` (`twoFactor()`)

An application opening one of these lists (e.g. declaring `OauthClient` under its own `lists` to grant access) no longer also exposes the credential column — same behavior as the existing base-model deny, `sudo()` still reads it.

For a plugin the stack has no seeded credential set for, mark a field yourself:

```typescript
authPlugin({
  betterAuthPlugins: [passkey()],
  credentialFields: { passkey: ['publicKey'] },
})
```

`credentialFields` is additive only — it can add fields to any model (including a seeded one) but can never unmark a seeded field. An entry naming a field missing from a model your app actually derives throws at config time; an entry for a model your app doesn't derive is a no-op.
