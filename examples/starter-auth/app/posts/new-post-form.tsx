'use client'

import { useActionState } from 'react'
import { createPostAction, type CreatePostState } from '@/lib/actions/posts'

const initialState: CreatePostState = {}

export function NewPostForm() {
  const [state, formAction, pending] = useActionState(createPostAction, initialState)

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-gray-200 p-4">
      <h2 className="text-lg font-semibold">New post</h2>
      <input
        name="title"
        aria-label="Title"
        placeholder="Title"
        className="w-full rounded border p-2"
      />
      <input
        name="slug"
        aria-label="Slug"
        placeholder="Slug"
        className="w-full rounded border p-2"
      />
      <textarea
        name="content"
        aria-label="Content"
        placeholder="Content"
        className="w-full rounded border p-2"
      />
      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
          {state.fieldErrors
            ? ` (${Object.entries(state.fieldErrors)
                .map(([name, message]) => `${name}: ${message}`)
                .join('; ')})`
            : null}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="rounded bg-blue-600 px-4 py-2 text-white">
        Create draft
      </button>
    </form>
  )
}
