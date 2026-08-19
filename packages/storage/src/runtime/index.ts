import type { OpenSaasConfig } from '@opensaas/stack-core'
import type {
  StorageProvider,
  FileMetadata,
  ImageMetadata,
  ImageTransformationConfig,
} from '../config/types.js'
import { validateFile, getMimeType, type FileValidationOptions } from '../utils/upload.js'
import { getImageDimensions, processImageTransformations } from '../utils/image.js'
import { getStorageProviderFactory } from './registry.js'

/**
 * Creates a storage provider instance from config.
 *
 * The provider `type` is resolved through the provider registry (see
 * {@link registerStorageProvider}) rather than a closed `switch`. `'local'` is
 * registered as a built-in default, so it works with no registration step.
 * Optional providers (`@opensaas/stack-storage-s3`,
 * `@opensaas/stack-storage-vercel`) and custom providers must be registered by
 * the host before they can be constructed.
 *
 * @throws If the named provider is not present in `config.storage`.
 * @throws If no provider factory has been registered for the config's `type`.
 */
export function createStorageProvider(
  config: OpenSaasConfig,
  providerName: string,
): StorageProvider {
  if (!config.storage || !config.storage[providerName]) {
    throw new Error(`Storage provider '${providerName}' not found in config`)
  }

  const providerConfig = config.storage[providerName]

  const factory = getStorageProviderFactory(providerConfig.type)
  if (!factory) {
    throw new Error(
      `Unknown storage provider type: ${providerConfig.type}. ` +
        `Register it with registerStorageProvider('${providerConfig.type}', ...) from ` +
        `'@opensaas/stack-storage/runtime' before use.`,
    )
  }

  return factory(providerConfig)
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

  const provider = createStorageProvider(config, storageProviderName)

  const contentType = file.type || getMimeType(file.name)

  const result = await provider.upload(buffer, file.name, {
    contentType,
    metadata: options?.metadata,
  })

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

  const provider = createStorageProvider(config, storageProviderName)

  const contentType = file.type || getMimeType(file.name)

  const { width, height } = await getImageDimensions(buffer)

  const result = await provider.upload(buffer, file.name, {
    contentType,
    metadata: options?.metadata,
  })

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

export async function deleteFile(
  config: OpenSaasConfig,
  storageProviderName: string,
  filename: string,
): Promise<void> {
  const provider = createStorageProvider(config, storageProviderName)
  await provider.delete(filename)
}

export async function deleteImage(config: OpenSaasConfig, metadata: ImageMetadata): Promise<void> {
  const provider = createStorageProvider(config, metadata.storageProvider)

  await provider.delete(metadata.filename)

  if (metadata.transformations) {
    for (const transformationResult of Object.values(metadata.transformations)) {
      const filename = transformationResult.url.split('/').pop()
      if (filename) {
        await provider.delete(filename)
      }
    }
  }
}

export { parseFileFromFormData } from '../utils/upload.js'

// Provider registration API: hosts register optional/custom providers so
// createStorageProvider can construct them (see registry.ts).
export {
  registerStorageProvider,
  getStorageProviderFactory,
  hasStorageProvider,
  resetStorageProviderRegistry,
  type StorageProviderFactory,
} from './registry.js'
