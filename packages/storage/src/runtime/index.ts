import type { OpenSaasConfig } from '@opensaas/stack-core'
import type { StorageUtils } from '@opensaas/stack-core/internal'
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
    Record<string, { url: string; width: number; height: number; size: number }> | undefined
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

/**
 * Builds the storage surface a `file()`/`image()` field writes through.
 *
 * `StorageUtils` types its option and metadata arguments as `unknown` because
 * core cannot name this package's types — core is this package's dependency,
 * not the other way round. This factory is the one place that re-narrows them,
 * so a consumer needing the surface (a test on `@opensaas/stack-core/testing`,
 * a custom context) does not have to write that conversion itself.
 *
 * @example
 * ```typescript
 * import { createStorageUtils } from '@opensaas/stack-storage/runtime'
 * import { createTestContext } from '@opensaas/stack-core/testing'
 *
 * const harness = await createTestContext(config, null, {
 *   storage: createStorageUtils(config),
 * })
 * ```
 */
export function createStorageUtils(config: OpenSaasConfig): StorageUtils {
  return {
    uploadFile: (providerName, file, buffer, options) =>
      uploadFile(config, providerName, { file, buffer }, uploadFileOptions(options)),
    uploadImage: (providerName, file, buffer, options) =>
      uploadImage(config, providerName, { file, buffer }, uploadImageOptions(options)),
    deleteFile: (providerName, filename) => deleteFile(config, providerName, filename),
    deleteImage: (metadata) =>
      isImageMetadata(metadata) ? deleteImage(config, metadata) : Promise.resolve(),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function uploadFileOptions(options: unknown): UploadFileOptions | undefined {
  if (!isRecord(options)) return undefined
  const result: UploadFileOptions = {}
  const { validation, metadata } = options
  if (isRecord(validation)) result.validation = validation
  if (isRecord(metadata)) result.metadata = stringRecord(metadata)
  return result
}

function uploadImageOptions(options: unknown): UploadImageOptions | undefined {
  const base = uploadFileOptions(options)
  if (!isRecord(options)) return base
  const { transformations } = options
  if (!isRecord(transformations)) return base
  const result: UploadImageOptions = { ...base, transformations: {} }
  for (const [name, transformation] of Object.entries(transformations)) {
    if (isRecord(transformation))
      result.transformations = { ...result.transformations, [name]: transformation }
  }
  return result
}

function stringRecord(value: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') result[key] = entry
  }
  return result
}

function isImageMetadata(value: unknown): value is ImageMetadata {
  return isRecord(value) && typeof value.filename === 'string' && typeof value.url === 'string'
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
