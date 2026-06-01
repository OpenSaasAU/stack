import { ForgotPasswordForm } from '@opensaas/stack-auth/ui'
import { authClient } from '@/lib/auth-client'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground">Reset Password</h1>
          <p className="text-muted-foreground mt-2">Enter your email to receive a reset link</p>
        </div>

        <div className="bg-card text-card-foreground border border-border rounded-lg shadow-md p-8">
          <ForgotPasswordForm authClient={authClient} />

          <div className="mt-6 text-center text-sm">
            <Link href="/sign-in" className="text-primary hover:underline">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
