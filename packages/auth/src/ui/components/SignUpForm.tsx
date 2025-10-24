'use client'

import React, { useState } from 'react'

export type SignUpFormProps = {
  /**
   * Better-auth client instance
   */
  authClient: any
  /**
   * URL to redirect to after successful sign up
   * @default '/'
   */
  redirectTo?: string
  /**
   * Show OAuth provider buttons
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
 * Sign up form component
 * Provides email/password registration and OAuth provider buttons
 *
 * @example
 * ```typescript
 * import { SignUpForm } from '@opensaas/framework-auth/ui'
 * import { authClient } from '@/lib/auth-client'
 *
 * export default function SignUpPage() {
 *   return <SignUpForm authClient={authClient} redirectTo="/admin" />
 * }
 * ```
 */
export function SignUpForm({
  authClient,
  redirectTo = '/',
  showSocialProviders = true,
  socialProviders = ['github', 'google'],
  requirePasswordConfirmation = true,
  className = '',
  onSuccess,
  onError,
}: SignUpFormProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validate password confirmation
    if (requirePasswordConfirmation && password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      const result = await authClient.signUp.email({
        email,
        password,
        name,
        callbackURL: redirectTo,
      })

      if (result.error) {
        throw new Error(result.error.message)
      }

      onSuccess?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign up failed'
      setError(message)
      onError?.(err instanceof Error ? err : new Error(message))
    } finally {
      setLoading(false)
    }
  }

  const handleSocialSignUp = async (provider: string) => {
    setError('')
    setLoading(true)

    try {
      await authClient.signIn.social({
        provider,
        callbackURL: redirectTo,
      })
      onSuccess?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign up failed'
      setError(message)
      onError?.(err instanceof Error ? err : new Error(message))
      setLoading(false)
    }
  }

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

      {showSocialProviders && socialProviders.length > 0 && (
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
