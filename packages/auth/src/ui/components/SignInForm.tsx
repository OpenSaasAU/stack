'use client'

import React, { useState } from 'react'
import type { createAuthClient } from 'better-auth/react'

export type SignInFormProps = {
  /**
   * Better-auth client instance
   * Created with createAuthClient from better-auth/react
   * Pass your client from lib/auth-client.ts
   */
  authClient: ReturnType<typeof createAuthClient>
  /**
   * URL to redirect to after successful sign in
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
   * Custom CSS class for the form container
   */
  className?: string
  /**
   * Callback when sign in is successful
   */
  onSuccess?: () => void
  /**
   * Callback when sign in fails
   */
  onError?: (error: Error) => void
}

/**
 * Sign in form component
 * Provides email/password sign in and OAuth provider buttons
 *
 * @example
 * ```typescript
 * import { SignInForm } from '@opensaas/framework-auth/ui'
 * import { authClient } from '@/lib/auth-client'
 *
 * export default function SignInPage() {
 *   return <SignInForm authClient={authClient} redirectTo="/admin" />
 * }
 * ```
 */
export function SignInForm({
  authClient,
  redirectTo = '/',
  showSocialProviders = true,
  socialProviders = ['github', 'google'],
  className = '',
  onSuccess,
  onError,
}: SignInFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await authClient.signIn.email({
        email,
        password,
        callbackURL: redirectTo,
      })

      if (result.error) {
        throw new Error(result.error.message)
      }

      onSuccess?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed'
      setError(message)
      onError?.(err instanceof Error ? err : new Error(message))
    } finally {
      setLoading(false)
    }
  }

  const handleSocialSignIn = async (provider: string) => {
    setError('')
    setLoading(true)

    try {
      await authClient.signIn.social({
        provider,
        callbackURL: redirectTo,
      })
      onSuccess?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed'
      setError(message)
      onError?.(err instanceof Error ? err : new Error(message))
      setLoading(false)
    }
  }

  return (
    <div className={`w-full max-w-md mx-auto p-6 ${className}`}>
      <h2 className="text-2xl font-bold mb-6">Sign In</h2>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
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

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {loading ? 'Signing in...' : 'Sign In'}
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
                onClick={() => handleSocialSignIn(provider)}
                disabled={loading}
                className="w-full bg-white border border-gray-300 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed"
              >
                Sign in with {provider.charAt(0).toUpperCase() + provider.slice(1)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
