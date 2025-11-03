'use server'

import { getContext } from '@/.opensaas/context'
import { revalidatePath } from 'next/cache'
import type { PostCreateInput, PostUpdateInput } from '../../.opensaas/types'

/**
 * Create a new post
 * Requires authentication (will return null if not authenticated)
 */
export async function createPost(authorId: string, data: Omit<PostCreateInput, 'author'>) {
  const context = getContext({ userId: authorId })

  const post = await context.db.post.create({
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
  const context = getContext({ userId })

  const post = await context.db.post.update({
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
  const context = getContext({ userId })

  const post = await context.db.post.update({
    where: { id: postId },
    data: {
      status: 'published',
      publishedAt: new Date(),
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
  const context = getContext({ userId })

  const post = await context.db.post.delete({
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
  const context = getContext()

  const posts = await context.db.post.findMany({
    where: { status: { equals: 'published' } },
  })

  return posts
}

/**
 * Get a single post by ID
 * Access control will determine what's visible
 */
export async function getPost(postId: string, userId?: string) {
  const context = getContext({ userId })

  const post = await context.db.post.findUnique({
    where: { id: postId },
  })

  return post
}

/**
 * Get all posts for a user (including drafts)
 */
export async function getUserPosts(userId: string) {
  const context = getContext({ userId })

  const posts = await context.db.post.findMany({
    where: { authorId: { equals: userId } },
  })

  return posts
}
