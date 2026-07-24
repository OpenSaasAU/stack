import { ForgotPasswordForm } from '@opensaas/stack-auth/ui'
import { requestPasswordResetAction } from '@/lib/actions/auth'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Reset Password</h1>
          <p className="text-gray-600 mt-2">Enter your email to receive a reset link</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8">
          <ForgotPasswordForm requestPasswordResetAction={requestPasswordResetAction} />

          <div className="mt-6 text-center text-sm">
            <Link href="/sign-in" className="text-blue-600 hover:underline">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
