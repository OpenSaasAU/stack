'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createProcedureClient } from '@opensaas/stack-core/procedures/client'
import type { procedures } from '@/lib/procedures'

const callProcedure = createProcedureClient<typeof procedures>()

type Outcome = { success: true } | { success: false; error: { message: string } }

interface PostControlsProps {
  id: string
  title: string
  status: 'draft' | 'published'
}

export function PostControls({ id, title, status }: PostControlsProps) {
  const router = useRouter()
  const [draftTitle, setDraftTitle] = useState(title)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function run(call: () => Promise<Outcome>) {
    setPending(true)
    const result = await call()
    setPending(false)
    if (result.success) {
      setMessage(null)
      router.refresh()
    } else {
      setMessage(result.error.message)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          aria-label="Post title"
          className="flex-1 rounded border p-2"
        />
        <span className="text-xs uppercase text-gray-500" data-status={status}>
          {status}
        </span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => callProcedure('updatePost', { id, title: draftTitle }))}
          className="rounded border px-3 py-1 text-sm"
        >
          Save title
        </button>
        {status === 'draft' ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => callProcedure('publishPost', { id }))}
            className="rounded border px-3 py-1 text-sm"
          >
            Publish
          </button>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => callProcedure('deletePost', { id }))}
          className="rounded border px-3 py-1 text-sm text-red-600"
        >
          Delete
        </button>
      </div>
      {message ? (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      ) : null}
    </div>
  )
}
