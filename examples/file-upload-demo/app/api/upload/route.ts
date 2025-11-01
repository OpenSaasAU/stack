import { NextRequest, NextResponse } from 'next/server'
import config from '@/opensaas.config'
import {
  uploadFile,
  uploadImage,
  parseFileFromFormData,
} from '@opensaas/stack-storage/runtime'
import type { FileMetadata, ImageMetadata } from '@opensaas/stack-storage'

/**
 * Upload API route
 *
 * This demonstrates how to implement file uploads with the storage system.
 * Developers have full control over validation, authentication, and processing.
 */
export async function POST(request: NextRequest) {
  try {
    // Get upload parameters from form data
    const formData = await request.formData()
    const storageProvider = formData.get('storage') as string
    const fieldType = formData.get('fieldType') as 'file' | 'image'

    // Validate storage provider
    if (!storageProvider) {
      return NextResponse.json(
        { error: 'Storage provider is required' },
        { status: 400 }
      )
    }

    // Parse file from FormData
    const fileData = await parseFileFromFormData(formData, 'file')
    if (!fileData) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Optional: Add authentication check
    // const session = await getSession()
    // if (!session) {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // }

    let metadata: FileMetadata | ImageMetadata

    // Upload based on field type
    if (fieldType === 'image') {
      // Get transformation config from the field definition
      // In a real app, you might want to read this from the config
      const transformations =
        storageProvider === 'avatars'
          ? {
              thumbnail: { width: 100, height: 100, fit: 'cover' as const, format: 'webp' as const },
              profile: { width: 400, height: 400, fit: 'cover' as const, format: 'webp' as const },
            }
          : undefined

      metadata = await uploadImage(config, storageProvider, fileData, {
        validation: {
          maxFileSize: 10 * 1024 * 1024, // 10MB
          acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        },
        transformations,
      })
    } else {
      metadata = await uploadFile(config, storageProvider, fileData, {
        validation: {
          maxFileSize: 10 * 1024 * 1024, // 10MB
          acceptedMimeTypes: [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          ],
        },
      })
    }

    return NextResponse.json(metadata)
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    )
  }
}
