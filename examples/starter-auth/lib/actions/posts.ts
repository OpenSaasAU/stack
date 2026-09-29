'use server'

import { getContext } from '@/.opensaas/context'
import { getSession } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import type { PostCreateInput, PostUpdateInput } from '../../.opensaas/types'

async function sessionContext() {
  const session = await getSession()
  return session ? getContext(session) : getContext()
}

/**
 * Create a post authored by the signed-in user
 */
export async function createPost(data: Omit<PostCreateInput, 'author'>) {
  const session = await getSession()
  if (!session?.userId) return { success: false, error: 'Failed to create post - access denied' }
  const context = await getContext(session)

  const post = await context.db.Post.create({
    data: {
      ...data,
      author: { connect: { id: session.userId } },
    },
  })

  if (!post) {
    return { success: false, error: 'Failed to create post - access denied' }
  }

  revalidatePath('/blog')
  return { success: true, post }
}

/**
 * Update a post
 * Only the author can update their own posts
 */
export async function updatePost(postId: string, data: PostUpdateInput) {
  const context = await sessionContext()

  const post = await context.db.Post.update({
    where: { id: postId },
    data,
  })

  if (!post) {
    return { success: false, error: 'Post not found or access denied' }
  }

  revalidatePath('/blog')
  return { success: true, post }
}

/**
 * Publish a post (set status to published)
 */
export async function publishPost(postId: string) {
  const context = await sessionContext()

  const post = await context.db.Post.update({
    where: { id: postId },
    data: {
      status: 'published',
      publishedAt: new Date().toISOString(),
    },
  })

  if (!post) {
    return { success: false, error: 'Post not found or access denied' }
  }

  revalidatePath('/blog')
  return { success: true, post }
}

/**
 * Delete a post
 * Only the author can delete their own posts
 */
export async function deletePost(postId: string) {
  const context = await sessionContext()

  const post = await context.db.Post.delete({
    where: { id: postId },
  })

  if (!post) {
    return { success: false, error: 'Post not found or access denied' }
  }

  revalidatePath('/blog')
  return { success: true }
}

/**
 * Get all published posts (no authentication required)
 */
export async function getPublishedPosts() {
  const context = await getContext()

  return context.db.Post.where({ status: { equals: 'published' } }).all()
}

/**
 * Get a single post by ID
 * Access control will determine what's visible: `null` is not-found or denied
 */
export async function getPost(postId: string) {
  const context = await sessionContext()

  return context.db.Post.where({ id: { equals: postId } }).first()
}

/**
 * Get the signed-in user's posts (including drafts)
 */
export async function getUserPosts() {
  const session = await getSession()
  if (!session?.userId) return []
  const context = await getContext(session)

  return context.db.Post.where({ authorId: { equals: session.userId } }).all()
}
