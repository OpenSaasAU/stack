'use client'

import { useState } from 'react'

interface ConsentFormProps {
  consentCode: string
  scopes: string[]
}

export function ConsentForm({ consentCode, scopes }: ConsentFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function respond(accept: boolean) {
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept, consent_code: consentCode }),
      })
      const result: { redirectURI?: string; redirect_uri?: string; message?: string } =
        await response.json()
      const target = result.redirectURI ?? result.redirect_uri
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
