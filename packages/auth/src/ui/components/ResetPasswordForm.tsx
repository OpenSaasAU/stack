'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation.js'
import { cleanAuthErrorMessage } from '../lib/clean-error-message.js'
import type { ResetPasswordAction } from '../types.js'

export type ResetPasswordFormProps = {
  /**
   * Server action that completes the password reset.
   * Define it in your app (`'use server'`) against your own auth instance.
   */
  resetPasswordAction: ResetPasswordAction
  /**
   * The reset token from the email link. The page reads it from
   * `searchParams.token` and passes it in. When empty, the form renders an
   * "invalid or expired link" state instead of a password form.
   */
  token: string
  /**
   * URL to redirect to after a successful reset
   * @default '/sign-in'
   */
  redirectTo?: string
  /**
   * Require password confirmation
   * @default true
   */
  requirePasswordConfirmation?: boolean
  /**
   * Custom CSS class for the form container
   */
  className?: string
  /**
   * Callback when the reset succeeds
   */
  onSuccess?: () => void
  /**
   * Callback when the reset fails
   */
  onError?: (error: Error) => void
}

/**
 * Reset password form component
 * Completes a password reset using the token from the reset email.
 *
 * Submits through an app-owned server action rather than calling the auth API
 * from the browser. See the "Auth action" contract in `@opensaas/stack-auth/ui`.
 *
 * @example
 * ```typescript
 * import { ResetPasswordForm } from '@opensaas/stack-auth/ui'
 * import { resetPasswordAction } from '@/lib/actions/auth'
 *
 * export default async function ResetPasswordPage({
 *   searchParams,
 * }: {
 *   searchParams: Promise<{ token?: string }>
 * }) {
 *   const { token } = await searchParams
 *   return <ResetPasswordForm resetPasswordAction={resetPasswordAction} token={token ?? ''} />
 * }
 * ```
 */
export function ResetPasswordForm({
  resetPasswordAction,
  token,
  redirectTo = '/sign-in',
  requirePasswordConfirmation = true,
  className = '',
  onSuccess,
  onError,
}: ResetPasswordFormProps) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Guard: no token means the user hit this page directly or followed a
  // malformed/expired link. Don't render a form that can't succeed.
  if (!token) {
    return (
      <div className={`w-full max-w-md mx-auto p-6 ${className}`}>
        <h2 className="text-2xl font-bold mb-6">Reset Password</h2>
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          This password reset link is invalid or has expired. Please request a new one.
        </div>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (requirePasswordConfirmation && password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      const result = await resetPasswordAction({ token, password })

      if (!result.success) {
        throw new Error(cleanAuthErrorMessage(result.error, 'Failed to reset password'))
      }

      if (onSuccess) {
        onSuccess()
      } else {
        router.push(redirectTo)
      }
    } catch (err) {
      const message = cleanAuthErrorMessage(
        err instanceof Error ? err.message : undefined,
        'Failed to reset password',
      )
      setError(message)
      onError?.(err instanceof Error ? err : new Error(message))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`w-full max-w-md mx-auto p-6 ${className}`}>
      <h2 className="text-2xl font-bold mb-6">Reset Password</h2>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-2">
            New Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
        </div>

        {requirePasswordConfirmation && (
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium mb-2">
              Confirm New Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {loading ? 'Resetting...' : 'Reset Password'}
        </button>
      </form>
    </div>
  )
}
