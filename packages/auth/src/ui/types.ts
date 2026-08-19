/**
 * Contract types shared between the pre-built auth forms and the app-owned
 * `'use server'` actions they invoke instead of owning an `authClient`. See
 * ADR-0020.
 */

/**
 * The result an email/password (non-redirecting) auth action returns.
 * Success carries no payload; failure carries a display-ready message.
 */
export type AuthActionResult = { success: true } | { success: false; error: string }

export type SignInInput = { email: string; password: string }

export type SignUpInput = { name: string; email: string; password: string }

export type RequestPasswordResetInput = { email: string }

export type ResetPasswordInput = { token: string; password: string }

export type SignInAction = (input: SignInInput) => Promise<AuthActionResult>

export type SignUpAction = (input: SignUpInput) => Promise<AuthActionResult>

export type RequestPasswordResetAction = (
  input: RequestPasswordResetInput,
) => Promise<AuthActionResult>

export type ResetPasswordAction = (input: ResetPasswordInput) => Promise<AuthActionResult>

/**
 * Starts an OAuth sign-in for the given provider. Unlike the email actions this
 * one navigates away (it performs a server-side redirect to the provider), so
 * it resolves to `void` and never returns a result to the form.
 */
export type SignInSocialAction = (provider: string) => Promise<void>
