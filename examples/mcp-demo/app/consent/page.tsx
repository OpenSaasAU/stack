import { ConsentForm } from './ConsentForm'

interface ConsentPageProps {
  searchParams: Promise<{ scope?: string; sig?: string }>
}

export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const { scope, sig } = await searchParams

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-4 text-2xl font-bold">Authorize access</h1>
        {sig ? (
          <ConsentForm scopes={scope ? scope.split(' ') : []} />
        ) : (
          <p>No pending consent request.</p>
        )}
      </div>
    </div>
  )
}
