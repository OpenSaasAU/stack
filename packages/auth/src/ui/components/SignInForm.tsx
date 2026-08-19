'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation.js'
import { cleanAuthErrorMessage } from '../lib/clean-error-message.js'
import type { SignInAction, SignInSocialAction } from '../types.js'

export type SignInFormProps = {
  /**
   * Server action that signs a user in with email + password.
   * Define it in your app (`'use server'`) against your own auth instance.
   */
  signInAction: SignInAction
  /**
   * Server action that starts an OAuth sign-in and redirects to the provider.
   * Required to render the social provider buttons; omit to hide them.
   */
  signInSocialAction?: SignInSocialAction
  /**
   * URL to redirect to after successful sign in
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
 * Submits through app-owned server actions rather than calling the auth API
 * from the browser. See the "Auth action" contract in `@opensaas/stack-auth/ui`.
 *
 * @example
 * ```typescript
 * import { SignInForm } from '@opensaas/stack-auth/ui'
 * import { signInAction, signInSocialAction } from '@/lib/actions/auth'
 *
 * export default function SignInPage() {
 *   return (
 *     <SignInForm
 *       signInAction={signInAction}
 *       signInSocialAction={signInSocialAction}
 *       redirectTo="/admin"
 *     />
 *   )
 * }
 * ```
 */
export function SignInForm({
  signInAction,
  signInSocialAction,
  redirectTo = '/',
  showSocialProviders = true,
  socialProviders = ['github', 'google'],
  className = '',
  onSuccess,
  onError,
}: SignInFormProps) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await signInAction({ email, password })

      if (!result.success) {
        throw new Error(cleanAuthErrorMessage(result.error, 'Sign in failed'))
      }

      if (onSuccess) {
        onSuccess()
      } else {
        router.push(redirectTo)
      }
    } catch (err) {
      const message = cleanAuthErrorMessage(
        err instanceof Error ? err.message : undefined,
        'Sign in failed',
      )
      setError(message)
      onError?.(err instanceof Error ? err : new Error(message))
    } finally {
      setLoading(false)
    }
  }

  const handleSocialSignIn = async (provider: string) => {
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
        'Sign in failed',
      )
      setError(message)
      onError?.(err instanceof Error ? err : new Error(message))
      setLoading(false)
    }
  }

  const canShowSocial = showSocialProviders && socialProviders.length > 0 && !!signInSocialAction

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
