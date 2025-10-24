import { SignInForm } from '@opensaas/framework-auth/ui'
import { authClient } from '@/lib/auth-client'
import Link from 'next/link'

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Welcome Back</h1>
          <p className="text-gray-600 mt-2">Sign in to your account</p>
        </div>

        <div className="bg-gray-500 rounded-lg shadow-md p-8">
          <SignInForm authClient={authClient} redirectTo="/admin" showSocialProviders={false} />

          <div className="mt-6 text-center text-sm">
            <Link href="/forgot-password" className="text-blue-600 hover:underline">
              Forgot your password?
            </Link>
          </div>

          <div className="mt-4 text-center text-sm text-gray-600">
            Don&apost have an account?{' '}
            <Link href="/sign-up" className="text-blue-600 hover:underline font-medium">
              Sign up
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
