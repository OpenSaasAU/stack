---
'@opensaas/stack-auth': minor
---

`createAuth()` now forwards `AuthConfig` options it previously normalized but silently dropped: `emailAndPassword.minPasswordLength`, `passwordReset.enabled`/`tokenExpiration` (wired to better-auth's `sendResetPassword`), and `emailVerification.enabled`/`sendOnSignUp`/`tokenExpiration` (wired to `sendVerificationEmail`). `sendEmail` is now actually invoked by these callbacks instead of being normalized and never called — apps relying on the previous no-op behavior (verification/reset emails silently not sending) will start sending real emails once `emailVerification`/`passwordReset` are enabled.

Two related fixes, both changing existing behavior:

- `session.updateAge` is retyped from `boolean` to `number | false` — the number of seconds between session refreshes, passed straight through to better-auth's own `session.updateAge` instead of being computed as `expiresIn / 10`. The default changes from `true` to `86400` (1 day), matching better-auth's own default. Update any `updateAge: true` config to a duration in seconds (e.g. `86400`). `updateAge: false` now correctly maps to better-auth's `disableSessionRefresh: true` (previously it mapped to `updateAge: 0`, which better-auth treats as "refresh on every request" — the opposite of disabling refresh).
- `getSessionFromAuth(auth, sessionFields, headers)` gains a required third `headers: Headers` parameter. Previously it always called `auth.api.getSession({ headers: new Headers() })`, an empty header set that could never resolve a session cookie, so the function always returned `null`. Callers must now pass the request's real headers (e.g. Next.js `await headers()`).

Setting `emailAndPassword.requireConfirmation` (while `emailAndPassword.enabled` is true) now logs a `console.warn` — it has no better-auth server-side equivalent (it's a UI-only "confirm password" concern). Pass `requirePasswordConfirmation` directly to `<SignUpForm>`/`<ResetPasswordForm>` instead. Similarly, `passwordReset.enabled` now warns if `emailAndPassword.enabled` is false, since password reset has no effect without a password-based account.
