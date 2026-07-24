/**
 * Contract types shared between the pre-built auth forms and the app-owned
 * server actions they invoke.
 *
 * The forms live in this package but never own an `auth` instance. Instead each
 * form receives **Auth actions** as props — `'use server'` functions the app
 * defines against its own better-auth instance. These types are the agreement
 * between the two: the app implements actions matching them, the forms call
 * actions matching them.
 */

/**
 * The result an email/password (non-redirecting) auth action returns.
 * Success carries no payload; failure carries a display-ready message.
 */
export type AuthActionResult = { success: true } | { success: false; error: string }

/** Input to the sign-in action. */
export type SignInInput = { email: string; password: string }

/** Input to the sign-up action. */
export type SignUpInput = { name: string; email: string; password: string }

/** Input to the request-password-reset action. */
export type RequestPasswordResetInput = { email: string }

/** Input to the reset-password action. */
export type ResetPasswordInput = { token: string; password: string }

/** Signs a user in with email + password. */
export type SignInAction = (input: SignInInput) => Promise<AuthActionResult>

/** Creates an account with email + password. */
export type SignUpAction = (input: SignUpInput) => Promise<AuthActionResult>

/** Requests a password-reset email. */
export type RequestPasswordResetAction = (
  input: RequestPasswordResetInput,
) => Promise<AuthActionResult>

/** Completes a password reset using a token from the reset email. */
export type ResetPasswordAction = (input: ResetPasswordInput) => Promise<AuthActionResult>

/**
 * Starts an OAuth sign-in for the given provider. Unlike the email actions this
 * one navigates away (it performs a server-side redirect to the provider), so
 * it resolves to `void` and never returns a result to the form.
 */
export type SignInSocialAction = (provider: string) => Promise<void>
