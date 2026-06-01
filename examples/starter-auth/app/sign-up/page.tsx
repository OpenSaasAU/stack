import { SignUpForm } from '@opensaas/stack-auth/ui'
import { authClient } from '@/lib/auth-client'
import Link from 'next/link'

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground">Create Account</h1>
          <p className="text-muted-foreground mt-2">Get started with OpenSaas Auth Demo</p>
        </div>

        <div className="bg-card text-card-foreground border border-border rounded-lg shadow-md p-8">
          <SignUpForm
            authClient={authClient}
            redirectTo="/admin"
            showSocialProviders={false}
            requirePasswordConfirmation={true}
          />

          <div className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/sign-in" className="text-primary hover:underline font-medium">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
