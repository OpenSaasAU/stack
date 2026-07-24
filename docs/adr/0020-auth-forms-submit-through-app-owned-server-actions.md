# Auth forms submit through app-owned server actions, not the browser auth client

## Context

The pre-built auth forms (`SignInForm`, `SignUpForm`, `ForgotPasswordForm`, and now
`ResetPasswordForm`) took a better-auth `authClient` prop and called `authClient.*`
from the browser, which hit the `/api/auth/*` REST route directly. We want the
authentication network surface to stay server-side (no browser dependency on
`NEXT_PUBLIC_APP_URL`, fewer origin/CORS concerns) and to match the app's existing
`lib/actions/*` server-action convention.

## Decision

The forms now invoke **Auth actions** — app-owned `'use server'` functions that call
better-auth's server API (`auth.api.*`) against the app's own auth instance — passed
in as props, **one prop per concern** (`signInAction`, `signUpAction`,
`requestPasswordResetAction`, `resetPasswordAction`, `signInSocialAction`). The
`authClient` prop is removed from every form.

- **The package owns only the form components and the actions' contract types**
  (`SignInInput`, `SignUpInput`, `RequestPasswordResetInput`, `ResetPasswordInput`,
  and `AuthActionResult = { success: true } | { success: false; error: string }`).
  It does **not** export shared action logic — better-auth's `auth.api.*` already is
  that logic, and threading the app's auth instance through a package helper buys
  friction, not safety. The `[body.field]` error-message cleanup stays internal to
  the form.
- **The app (and the `starter-auth` template / CLI generator) owns the action
  implementations** in `lib/actions/auth.ts`, calling `auth.api.*` directly.
- **`createAuth` auto-adds better-auth's `nextCookies()` plugin as the last plugin**,
  so a session cookie set during a server-action call is written into Next's
  `cookies()` without every app remembering the one step that makes sign-in persist.
- **Redirect is asymmetric by design:** email actions return an `AuthActionResult`
  and the client form redirects (`redirectTo` + `onSuccess`/`onError` preserved),
  while social sign-in must navigate away, so its action performs a server-side
  `redirect()` to the provider URL. This reflects that OAuth leaves the app and email
  does not — not an inconsistency.
- **`createClient` is kept** in the package for client-side session reading
  (`useSession`), but the now-unused `auth-client.ts` is dropped from the templates.

## Considered options

- **Keep `authClient` for social only** — rejected: a form would need both an action
  prop and `authClient`, reintroducing exactly what we removed.
- **Server-side `redirect()` for email too** — rejected: drops the client-controlled
  `redirectTo` and the `onSuccess`/`onError` callbacks, and errors still have to come
  back as data anyway.
- **A package `createAuthActions(auth)` factory / exported action helpers** —
  rejected: shadows better-auth's own API and couples the package to a fragile
  `ReturnType<typeof betterAuth>` parameter.

## Consequences

- Breaking change to `@opensaas/stack-auth/ui`'s form props (`authClient` → per-concern
  action props). Released as a **minor** bump: the packages are pre-1.0 (0.x), where a
  minor may carry breaking changes by semver convention. The CLI feature-generator and
  all three auth examples (`starter-auth`, `auth-demo`, `mcp-demo`) are updated in the
  same change, since a green build and a correct scaffolder require it.
- This ADR also folds in the previously-missing `reset-password` page and
  `ResetPasswordForm`, completing the forgot-password flow that until now dead-ended
  on a 404.
