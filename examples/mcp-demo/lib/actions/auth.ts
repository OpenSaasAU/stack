'use server'

import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import type { AuthActionResult, SignInInput } from '@opensaas/stack-auth/ui'

/**
 * App-owned auth server actions. The pre-built auth forms submit through these
 * (calling better-auth's server API directly) instead of the browser calling
 * `/api/auth/*`. `createAuth` auto-adds better-auth's `nextCookies` plugin, so
 * the session cookie set inside these actions persists. See ADR-0020.
 */

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

export async function signInAction(input: SignInInput): Promise<AuthActionResult> {
  try {
    await auth.api.signInEmail({
      body: { email: input.email, password: input.password },
      headers: await headers(),
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: errorMessage(err, 'Sign in failed') }
  }
}
