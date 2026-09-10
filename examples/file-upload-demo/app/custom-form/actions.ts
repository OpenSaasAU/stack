'use server'

import { getContext } from '@/.opensaas/context'
import type { FileMetadata, ImageMetadata } from '@opensaas/stack-storage'
import { revalidatePath } from 'next/cache'

export async function createPost(data: {
  title: string
  content: string
  coverImage: File | ImageMetadata | null
  attachment: File | FileMetadata | null
}) {
  try {
    const context = await getContext()

    const post = await context.db.Post.create({
      data: {
        title: data.title,
        content: data.content,
        coverImage: data.coverImage,
        attachment: data.attachment,
      },
    })

    if (!post) {
      return { success: false, error: 'Failed to create post — access denied' }
    }

    revalidatePath('/admin')

    // The id, not the row: everything else — the stored file and image
    // metadata included — would cross the server/client boundary unread.
    return {
      success: true,
      id: post.id,
    }
  } catch (error) {
    console.error('Error creating post:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create post',
    }
  }
}
