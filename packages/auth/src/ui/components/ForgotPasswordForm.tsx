'use client'

import React, { useState } from 'react'
import { cleanAuthErrorMessage } from '../lib/clean-error-message.js'
import type { RequestPasswordResetAction } from '../types.js'

export type ForgotPasswordFormProps = {
  /**
   * Server action that requests a password-reset email.
   * Define it in your app (`'use server'`) against your own auth instance.
   */
  requestPasswordResetAction: RequestPasswordResetAction
  /**
   * Custom CSS class for the form container
   */
  className?: string
  /**
   * Callback when reset email is sent successfully
   */
  onSuccess?: () => void
  /**
   * Callback when reset fails
   */
  onError?: (error: Error) => void
}

/**
 * Forgot password form component
 * Allows users to request a password reset email
 *
 * Submits through an app-owned server action rather than calling the auth API
 * from the browser. See the "Auth action" contract in `@opensaas/stack-auth/ui`.
 *
 * @example
 * ```typescript
 * import { ForgotPasswordForm } from '@opensaas/stack-auth/ui'
 * import { requestPasswordResetAction } from '@/lib/actions/auth'
 *
 * export default function ForgotPasswordPage() {
 *   return <ForgotPasswordForm requestPasswordResetAction={requestPasswordResetAction} />
 * }
 * ```
 */
export function ForgotPasswordForm({
  requestPasswordResetAction,
  className = '',
  onSuccess,
  onError,
}: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setLoading(true)

    try {
      const result = await requestPasswordResetAction({ email })

      if (!result.success) {
        throw new Error(cleanAuthErrorMessage(result.error, 'Failed to send reset email'))
      }

      setSuccess(true)
      onSuccess?.()
    } catch (err) {
      const message = cleanAuthErrorMessage(
        err instanceof Error ? err.message : undefined,
        'Failed to send reset email',
      )
      setError(message)
      onError?.(err instanceof Error ? err : new Error(message))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`w-full max-w-md mx-auto p-6 ${className}`}>
      <h2 className="text-2xl font-bold mb-6">Forgot Password</h2>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
          Password reset email sent! Check your inbox for instructions.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-2">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading || success}
          />
        </div>

        <button
          type="submit"
          disabled={loading || success}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {loading ? 'Sending...' : success ? 'Email Sent' : 'Send Reset Link'}
        </button>
      </form>
    </div>
  )
}
