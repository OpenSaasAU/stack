---
'@opensaas/stack-auth': minor
---

`createAuth()` now forwards `AuthConfig` options it previously normalized but silently dropped: `emailAndPassword.minPasswordLength`, `passwordReset.enabled`/`tokenExpiration` (wired to better-auth's `sendResetPassword`), and `emailVerification.enabled`/`sendOnSignUp`/`tokenExpiration` (wired to `sendVerificationEmail`).

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
