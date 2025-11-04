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

    const post = await context.db.post.create({
      data: {
        title: data.title,
        content: data.content,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        coverImage: (data.coverImage ?? undefined) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        attachment: (data.attachment ?? undefined) as any,
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
