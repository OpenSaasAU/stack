import { SignUpForm } from '@opensaas/framework-auth/ui'
import { authClient } from '@/lib/auth-client'
import Link from 'next/link'

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Create Account</h1>
          <p className="text-gray-600 mt-2">Get started with OpenSaaS Auth Demo</p>
        </div>

        <div className="bg-gray-600 rounded-lg shadow-md p-8">
          <SignUpForm
            authClient={authClient}
            redirectTo="/admin"
            showSocialProviders={false}
            requirePasswordConfirmation={true}
          />

          <div className="mt-6 text-center text-sm text-gray-600">
            Already have an account?{' '}
            <Link href="/sign-in" className="text-blue-600 hover:underline font-medium">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
