'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getContext } from '@/.opensaas/context'
import type { PostCreateInput, PostUpdateInput } from '@/.opensaas/types'
import { demoSession } from './demo-session'

export async function createPost(data: PostCreateInput) {
  try {
    const session = await demoSession()
    const context = await getContext(session)

    // The author is the caller, not something the form supplies
    const { author: _author, ...postData } = data

    const post = await context.db.Post.create({
      data: {
        ...postData,
        status: postData.status || 'draft',
        publishedAt: postData.publishedAt ?? undefined,
        author: session === undefined ? null : { connect: { id: session.userId } },
      },
    })

    if (!post) {
      return { success: false, error: 'Failed to create post' }
    }

    revalidatePath('/')
    revalidatePath('/posts')
    return { success: true, data: post }
  } catch (error: unknown) {
    console.error('Create post error:', error)
    const message = error instanceof Error ? error.message : 'Failed to create post'
    return { success: false, error: message }
  }
}

export async function updatePost(id: string, data: PostUpdateInput) {
  const context = await getContext(await demoSession())

  const post = await context.db.Post.update({
    where: { id },
    data: {
      title: data.title,
      slug: data.slug,
      content: data.content,
      status: data.status || 'draft',
      internalNotes: data.internalNotes,
      publishedAt: data.publishedAt ?? undefined,
    },
  })

  if (!post) {
    return { success: false, error: 'Access denied or post not found' }
  }

  revalidatePath('/')
  revalidatePath('/posts')
  revalidatePath(`/posts/${id}`)
  return { success: true, data: post }
}

export async function deletePost(id: string) {
  const context = await getContext(await demoSession())

  const post = await context.db.Post.delete({
    where: { id },
  })

  if (!post) {
    return { success: false, error: 'Access denied or post not found' }
  }

  revalidatePath('/')
  revalidatePath('/posts')
  redirect('/posts')
}
