'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { postAuthEndpoint, signOutAndConfirm } from '@opensaas/stack-auth/server'
import type {
  AuthActionResult,
  SignInInput,
  SignUpInput,
  RequestPasswordResetInput,
  ResetPasswordInput,
} from '@opensaas/stack-auth/ui'

/**
 * App-owned auth server actions. The pre-built auth forms submit through these
 * (calling better-auth's server API directly) instead of the browser calling
 * `/api/auth/*`. `createAuth` auto-adds better-auth's `nextCookies` plugin, so
 * the session cookie set inside these actions persists. See ADR-0020.
 */

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

async function postToAuth(path: string, body: Record<string, unknown>): Promise<AuthActionResult> {
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

export async function signUpAction(input: SignUpInput): Promise<AuthActionResult> {
  return postToAuth('/sign-up/email', {
    name: input.name,
    email: input.email,
    password: input.password,
  })
}

export async function requestPasswordResetAction(
  input: RequestPasswordResetInput,
): Promise<AuthActionResult> {
  return postToAuth('/request-password-reset', {
    email: input.email,
    redirectTo: '/reset-password',
  })
}

export async function resetPasswordAction(input: ResetPasswordInput): Promise<AuthActionResult> {
  try {
    await auth.api.resetPassword({
      body: { newPassword: input.password, token: input.token },
      headers: await headers(),
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: errorMessage(err, 'Failed to reset password') }
  }
}

export async function signOutAction(): Promise<void> {
  const logoutUrl = await signOutAndConfirm(auth, await headers())
  redirect(logoutUrl ?? '/sign-in')
}
