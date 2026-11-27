'use server'

import { redirect } from 'next/navigation'
import { callProcedure } from '@/lib/server'

export interface CreatePostState {
  error?: string
  fieldErrors?: Record<string, string>
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

export async function createPostAction(
  _previous: CreatePostState,
  formData: FormData,
): Promise<CreatePostState> {
  const result = await callProcedure('createPost', {
    title: field(formData, 'title'),
    slug: field(formData, 'slug'),
    content: field(formData, 'content'),
  })
  if (!result.success) {
    return { error: result.error.message, fieldErrors: result.error.fieldErrors }
  }
  redirect('/posts')
}
