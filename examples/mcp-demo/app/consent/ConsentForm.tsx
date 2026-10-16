'use client'

import { useState } from 'react'

interface ConsentFormProps {
  scopes: string[]
}

function signedOAuthQuery(search: string): string {
  const params = new URLSearchParams(search)
  const signedNames = new Set(params.getAll('ba_param'))
  const signed = new URLSearchParams()
  for (const [key, value] of params.entries()) {
    if (key === 'sig' || key === 'ba_param' || signedNames.has(key)) signed.append(key, value)
  }
  return signed.toString()
}

export function ConsentForm({ scopes }: ConsentFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function respond(accept: boolean) {
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept, oauth_query: signedOAuthQuery(window.location.search) }),
      })
      const result: { url?: string; redirect_uri?: string; message?: string } =
        await response.json()
      const target = result.url ?? result.redirect_uri
      const scheme = target ? new URL(target, window.location.origin).protocol : null
      if (!response.ok || !target || scheme === 'javascript:' || scheme === 'data:') {
        setError(result.message ?? 'Consent failed')
        setPending(false)
        return
      }
      window.location.href = target
    } catch {
      setError('Consent failed')
      setPending(false)
    }
  }

  return (
    <div className="space-y-4">
      <p>An application is requesting access to your account with these permissions:</p>
      <ul className="list-disc pl-6">
        {scopes.map((scope) => (
          <li key={scope}>{scope}</li>
        ))}
      </ul>
      {error && <p className="text-red-600">{error}</p>}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => respond(true)}
          className="rounded bg-blue-600 px-4 py-2 text-white"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => respond(false)}
          className="rounded border px-4 py-2"
        >
          Deny
        </button>
      </div>
    </div>
  )
}
