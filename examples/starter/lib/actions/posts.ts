'use server'

import { getContext } from '@/.opensaas/context'
import { revalidatePath } from 'next/cache'
import type { PostCreateInput, PostUpdateInput } from '../../.opensaas/types'

/**
 * `getContext` stores what it is handed as `session ?? null`, so `{ userId: undefined }`
 * is a *signed-in* session with no user — an access rule that branches on `!session`
 * takes its authenticated branch and an anonymous caller reads rows it should not see.
 * Deriving the session from an optional id here keeps that shape out of the call sites.
 */
function sessionFor(userId?: string) {
  return userId ? { userId } : undefined
}

/**
 * Create a new post
 * Requires authentication (will return null if not authenticated)
 */
export async function createPost(authorId: string, data: Omit<PostCreateInput, 'author'>) {
  const context = await getContext(sessionFor(authorId))

  const post = await context.db.Post.create({
    data: {
      ...data,
      author: { connect: { id: authorId } },
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
export async function updatePost(userId: string, postId: string, data: PostUpdateInput) {
  const context = await getContext(sessionFor(userId))

  const post = await context.db.Post.update({
    where: { id: postId },
    data,
    select: {
      title: true,
    },
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
export async function publishPost(userId: string, postId: string) {
  const context = await getContext(sessionFor(userId))

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
export async function deletePost(userId: string, postId: string) {
  const context = await getContext(sessionFor(userId))

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
export async function getPost(postId: string, userId?: string) {
  const context = await getContext(sessionFor(userId))

  return context.db.Post.where({ id: { equals: postId } }).first()
}

/**
 * Get all posts for a user (including drafts)
 */
export async function getUserPosts(userId: string) {
  const context = await getContext(sessionFor(userId))

  return context.db.Post.where({ authorId: { equals: userId } }).all()
}
