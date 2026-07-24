import { ResetPasswordForm } from '@opensaas/stack-auth/ui'
import { resetPasswordAction } from '@/lib/actions/auth'
import Link from 'next/link'

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Set a New Password</h1>
          <p className="text-gray-600 mt-2">Choose a new password for your account</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8">
          <ResetPasswordForm resetPasswordAction={resetPasswordAction} token={token ?? ''} />

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
