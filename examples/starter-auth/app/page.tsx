import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-md space-y-8 text-center">
        <div>
          <h1 className="text-4xl font-bold">OpenSaaS Stack</h1>
          <p className="mt-2 text-gray-600">Starter with Authentication</p>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Admin Dashboard</h2>
            <p className="mt-2 text-sm text-gray-600">Manage your posts and users</p>
            <Link
              href="/admin"
              className="mt-4 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Go to Admin
            </Link>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Authentication</h2>
            <div className="mt-4 flex gap-2">
              <Link
                href="/sign-in"
                className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Sign In
              </Link>
              <Link
                href="/sign-up"
                className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Sign Up
              </Link>
            </div>
          </div>
        </div>

        <div className="text-sm text-gray-500">
          <p>
            Learn more at{' '}
            <a
              href="https://stack.opensaas.au"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              stack.opensaas.au
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
