'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation.js'
import { cleanAuthErrorMessage } from '../lib/clean-error-message.js'
import type { SignUpAction, SignInSocialAction } from '../types.js'

export type SignUpFormProps = {
  /**
   * Server action that creates an account with email + password.
   * Define it in your app (`'use server'`) against your own auth instance.
   */
  signUpAction: SignUpAction
  /**
   * Server action that starts an OAuth sign-in and redirects to the provider.
   * Required to render the social provider buttons; omit to hide them.
   */
  signInSocialAction?: SignInSocialAction
  /**
   * URL to redirect to after successful sign up
   * @default '/'
   */
  redirectTo?: string
  /**
   * Show OAuth provider buttons (requires `signInSocialAction`)
   * @default true
   */
  showSocialProviders?: boolean
  /**
   * Which OAuth providers to show
   * @default ['github', 'google']
   */
  socialProviders?: string[]
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
   * Callback when sign up is successful
   */
  onSuccess?: () => void
  /**
   * Callback when sign up fails
   */
  onError?: (error: Error) => void
}

/**
 * Submits through app-owned server actions rather than calling the auth API
 * from the browser. See the "Auth action" contract in `@opensaas/stack-auth/ui`.
 *
 * @example
 * ```typescript
 * import { SignUpForm } from '@opensaas/stack-auth/ui'
 * import { signUpAction, signInSocialAction } from '@/lib/actions/auth'
 *
 * export default function SignUpPage() {
 *   return <SignUpForm signUpAction={signUpAction} redirectTo="/admin" />
 * }
 * ```
 */
export function SignUpForm({
  signUpAction,
  signInSocialAction,
  redirectTo = '/',
  showSocialProviders = true,
  socialProviders = ['github', 'google'],
  requirePasswordConfirmation = true,
  className = '',
  onSuccess,
  onError,
}: SignUpFormProps) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (requirePasswordConfirmation && password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      const result = await signUpAction({ name, email, password })

      if (!result.success) {
        throw new Error(cleanAuthErrorMessage(result.error, 'Sign up failed'))
      }

      if (onSuccess) {
        onSuccess()
      } else {
        router.push(redirectTo)
      }
    } catch (err) {
      const message = cleanAuthErrorMessage(
        err instanceof Error ? err.message : undefined,
        'Sign up failed',
      )
      setError(message)
      onError?.(err instanceof Error ? err : new Error(message))
    } finally {
      setLoading(false)
    }
  }

  const handleSocialSignUp = async (provider: string) => {
    if (!signInSocialAction) return
    setError('')
    setLoading(true)

    try {
      // The action performs a server-side redirect to the provider, so on
      // success control does not return here.
      await signInSocialAction(provider)
      onSuccess?.()
    } catch (err) {
      const message = cleanAuthErrorMessage(
        err instanceof Error ? err.message : undefined,
        'Sign up failed',
      )
      setError(message)
      onError?.(err instanceof Error ? err : new Error(message))
      setLoading(false)
    }
  }

  const canShowSocial = showSocialProviders && socialProviders.length > 0 && !!signInSocialAction

  return (
    <div className={`w-full max-w-md mx-auto p-6 ${className}`}>
      <h2 className="text-2xl font-bold mb-6">Sign Up</h2>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-2">
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName((e.target as HTMLInputElement).value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
        </div>

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
            disabled={loading}
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-2">
            Password
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
              Confirm Password
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
          {loading ? 'Creating account...' : 'Sign Up'}
        </button>
      </form>

      {canShowSocial && (
        <>
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-500">Or continue with</span>
            </div>
          </div>

          <div className="space-y-2">
            {socialProviders.map((provider) => (
              <button
                key={provider}
                onClick={() => handleSocialSignUp(provider)}
                disabled={loading}
                className="w-full bg-white border border-gray-300 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed"
              >
                Sign up with {provider.charAt(0).toUpperCase() + provider.slice(1)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
