import type { OpenSaasConfig } from '@opensaas/stack-core'
import type {
  StorageProvider,
  LocalStorageConfig,
  FileMetadata,
  ImageMetadata,
  ImageTransformationConfig,
} from '../config/types.js'
import { LocalStorageProvider } from '../providers/local.js'
import { validateFile, getMimeType, type FileValidationOptions } from '../utils/upload.js'
import { getImageDimensions, processImageTransformations } from '../utils/image.js'

/**
 * Creates a storage provider instance from config
 */
export function createStorageProvider(
  config: OpenSaasConfig,
  providerName: string,
): StorageProvider {
  if (!config.storage || !config.storage[providerName]) {
    throw new Error(`Storage provider '${providerName}' not found in config`)
  }

  const providerConfig = config.storage[providerName]

  switch (providerConfig.type) {
    case 'local':
      return new LocalStorageProvider(providerConfig as unknown as LocalStorageConfig)
    default:
      throw new Error(`Unknown storage provider type: ${providerConfig.type}`)
  }
}

/**
 * Options for uploading a file
 */
export interface UploadFileOptions {
  /** Validation options */
  validation?: FileValidationOptions
  /** Custom metadata */
  metadata?: Record<string, string>
}

/**
 * Options for uploading an image with transformations
 */
export interface UploadImageOptions extends UploadFileOptions {
  /** Image transformations to apply */
  transformations?: Record<string, ImageTransformationConfig>
}

/**
 * Uploads a file to the specified storage provider
 *
 * @example
 * ```typescript
 * const metadata = await uploadFile(config, 'documents', {
 *   file,
 *   buffer,
 *   validation: {
 *     maxFileSize: 10 * 1024 * 1024, // 10MB
 *     acceptedMimeTypes: ['application/pdf']
 *   }
 * })
 * ```
 */
export async function uploadFile(
  config: OpenSaasConfig,
  storageProviderName: string,
  data: {
    file: File
    buffer: Buffer
  },
  options?: UploadFileOptions,
): Promise<FileMetadata> {
  const { file, buffer } = data

  // Validate file
  if (options?.validation) {
    const validation = validateFile(
      {
        size: file.size,
        name: file.name,
        type: file.type,
      },
      options.validation,
    )

    if (!validation.valid) {
      throw new Error(validation.error)
    }
  }

  // Get storage provider
  const provider = createStorageProvider(config, storageProviderName)

  // Determine content type
  const contentType = file.type || getMimeType(file.name)

  // Upload file
  const result = await provider.upload(buffer, file.name, {
    contentType,
    metadata: options?.metadata,
  })

  // Return metadata
  return {
    filename: result.filename,
    originalFilename: file.name,
    url: result.url,
    mimeType: contentType,
    size: result.size,
    uploadedAt: new Date().toISOString(),
    storageProvider: storageProviderName,
    metadata: result.metadata,
  }
}

/**
 * Uploads an image with optional transformations
 *
 * @example
 * ```typescript
 * const metadata = await uploadImage(config, 'avatars', {
 *   file,
 *   buffer,
 *   validation: {
 *     maxFileSize: 5 * 1024 * 1024, // 5MB
 *     acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
 *   },
 *   transformations: {
 *     thumbnail: { width: 100, height: 100, fit: 'cover' },
 *     profile: { width: 400, height: 400, fit: 'cover' }
 *   }
 * })
 * ```
 */
export async function uploadImage(
  config: OpenSaasConfig,
  storageProviderName: string,
  data: {
    file: File
    buffer: Buffer
  },
  options?: UploadImageOptions,
): Promise<ImageMetadata> {
  const { file, buffer } = data

  // Validate file
  if (options?.validation) {
    const validation = validateFile(
      {
        size: file.size,
        name: file.name,
        type: file.type,
      },
      options.validation,
    )

    if (!validation.valid) {
      throw new Error(validation.error)
    }
  }

  // Get storage provider
  const provider = createStorageProvider(config, storageProviderName)

  // Determine content type
  const contentType = file.type || getMimeType(file.name)

  // Get original image dimensions
  const { width, height } = await getImageDimensions(buffer)

  // Upload original image
  const result = await provider.upload(buffer, file.name, {
    contentType,
    metadata: options?.metadata,
  })

  // Process transformations if provided
  let transformations:
    | Record<string, { url: string; width: number; height: number; size: number }>
    | undefined
  if (options?.transformations) {
    transformations = await processImageTransformations(
      buffer,
      file.name,
      options.transformations,
      provider,
      contentType,
    )
  }

  // Return metadata
  return {
    filename: result.filename,
    originalFilename: file.name,
    url: result.url,
    mimeType: contentType,
    size: result.size,
    width,
    height,
    uploadedAt: new Date().toISOString(),
    storageProvider: storageProviderName,
    metadata: result.metadata,
    transformations,
  }
}

/**
 * Deletes a file from storage
 */
export async function deleteFile(
  config: OpenSaasConfig,
  storageProviderName: string,
  filename: string,
): Promise<void> {
  const provider = createStorageProvider(config, storageProviderName)
  await provider.delete(filename)
}

/**
 * Deletes an image and all its transformations from storage
 */
export async function deleteImage(config: OpenSaasConfig, metadata: ImageMetadata): Promise<void> {
  const provider = createStorageProvider(config, metadata.storageProvider)

  // Delete original image
  await provider.delete(metadata.filename)

  // Delete all transformations
  if (metadata.transformations) {
    for (const transformationResult of Object.values(metadata.transformations)) {
      // Extract filename from URL
      const filename = transformationResult.url.split('/').pop()
      if (filename) {
        await provider.delete(filename)
      }
    }
  }
}

export { parseFileFromFormData } from '../utils/upload.js'
