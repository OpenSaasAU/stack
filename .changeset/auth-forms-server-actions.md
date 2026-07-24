---
'@opensaas/stack-auth': minor
'@opensaas/stack-cli': minor
---

Auth forms now submit through app-owned server actions instead of the browser `authClient`

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
