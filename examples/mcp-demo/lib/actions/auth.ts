'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { hasAuthBaseURL, MISSING_BASE_URL_MESSAGE } from '@/lib/base-url'
import { postAuthEndpoint, signOutAndConfirm } from '@opensaas/stack-auth/server'
import type { AuthActionResult, SignInInput } from '@opensaas/stack-auth/ui'

/**
 * App-owned auth server actions. The pre-built auth forms submit through these
 * (calling better-auth's server API directly) instead of the browser calling
 * `/api/auth/*`. `createAuth` auto-adds better-auth's `nextCookies` plugin, so
 * the session cookie set inside these actions persists. See ADR-0020.
 */

async function postToAuth(path: string, body: Record<string, unknown>): Promise<AuthActionResult> {
  if (!hasAuthBaseURL()) return { success: false, error: MISSING_BASE_URL_MESSAGE }
  const cookieStore = await cookies()
  return postAuthEndpoint(auth, {
    path,
    body,
    headers: await headers(),
    setCookie: (name, value, options) => cookieStore.set(name, value, options),
  })
}

export async function signInAction(input: SignInInput): Promise<AuthActionResult> {
  return postToAuth('/sign-in/email', { email: input.email, password: input.password })
}

export async function signOutAction(): Promise<void> {
  const logoutUrl = await signOutAndConfirm(auth, await headers())
  redirect(logoutUrl ?? '/sign-in')
}
