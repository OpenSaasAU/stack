import { ConsentForm } from './ConsentForm'

interface ConsentPageProps {
  searchParams: Promise<{ consent_code?: string; scope?: string }>
}

export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const { consent_code: consentCode, scope } = await searchParams

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-4 text-2xl font-bold">Authorize access</h1>
        {consentCode ? (
          <ConsentForm consentCode={consentCode} scopes={scope ? scope.split(' ') : []} />
        ) : (
          <p>No pending consent request.</p>
        )}
      </div>
    </div>
  )
}
