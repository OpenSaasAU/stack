'use server'

import { getContext } from '@/.opensaas/context'
import type { FileMetadata, ImageMetadata } from '@opensaas/stack-storage'
import { revalidatePath } from 'next/cache'

export async function createPost(data: {
  title: string
  content: string
  coverImage: ImageMetadata | null
  attachment: FileMetadata | null
}) {
  try {
    const context = getContext()

    const post = await context.db.post.create({
      data: {
        title: data.title,
        content: data.content,
        coverImage: data.coverImage,
        attachment: data.attachment,
      },
    })

    revalidatePath('/admin')

    return {
      success: true,
      post,
    }
  } catch (error) {
    console.error('Error creating post:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create post',
    }
  }
}
