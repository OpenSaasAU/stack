/**
 * Storage provider interface that all storage backends must implement.
 * This allows pluggable storage solutions (local, S3, Vercel Blob, etc.)
 */
export interface StorageProvider {
  /**
   * Uploads a file to the storage provider
   * @param file - File data as Buffer or Uint8Array
   * @param filename - Desired filename (may be transformed by provider)
   * @param options - Additional upload options (contentType, metadata, etc.)
   * @returns Upload result with URL and metadata
   */
  upload(
    file: Buffer | Uint8Array,
    filename: string,
    options?: UploadOptions,
  ): Promise<UploadResult>

  /**
   * Downloads a file from the storage provider
   * @param filename - Filename to download
   * @returns File data as Buffer
   */
  download(filename: string): Promise<Buffer>

  /**
   * Deletes a file from the storage provider
   * @param filename - Filename to delete
   */
  delete(filename: string): Promise<void>

  /**
   * Gets the public URL for a file
   * @param filename - Filename to get URL for
   * @returns Public URL string
   */
  getUrl(filename: string): string

  /**
   * Optional: Gets a signed URL for private files
   * @param filename - Filename to get signed URL for
   * @param expiresIn - Expiration time in seconds
   * @returns Signed URL string
   */
  getSignedUrl?(filename: string, expiresIn?: number): Promise<string>
}

/**
 * Options for uploading a file
 */
export interface UploadOptions {
  /** MIME type of the file */
  contentType?: string
  /** Custom metadata to store with the file */
  metadata?: Record<string, string>
  /** Whether the file should be publicly accessible */
  public?: boolean
  /** Cache control header */
  cacheControl?: string
}

/**
 * Result from uploading a file
 */
export interface UploadResult {
  /** Generated filename (may differ from input) */
  filename: string
  /** Public URL to access the file */
  url: string
  /** File size in bytes */
  size: number
  /** MIME type */
  contentType: string
  /** Additional provider-specific metadata */
  metadata?: Record<string, unknown>
}

/**
 * Configuration for local filesystem storage
 */
export interface LocalStorageConfig {
  type: 'local'
  /** Directory to store uploaded files */
  uploadDir: string
  /** Base URL for serving files (e.g., '/api/files' or 'https://cdn.example.com') */
  serveUrl: string
  /** Whether to generate unique filenames (default: true) */
  generateUniqueFilenames?: boolean
  /** Allow additional properties */
  [key: string]: unknown
}

/**
 * Base configuration shared by all storage providers
 */
export interface BaseStorageConfig {
  type: string
  [key: string]: unknown
}

/**
 * Storage configuration - maps names to storage provider configs
 * Example: { avatars: s3Config, documents: localConfig }
 */
export type StorageConfig = Record<string, BaseStorageConfig | LocalStorageConfig>

/**
 * Re-export metadata types from core package
 * These types are now defined in @opensaas/stack-core to avoid circular dependencies
 */
export type { FileMetadata, ImageMetadata, ImageTransformationResult } from '@opensaas/stack-core'

/**
 * Configuration for image transformations
 */
export interface ImageTransformationConfig {
  /** Target width in pixels */
  width?: number
  /** Target height in pixels */
  height?: number
  /** Fit mode: cover (crop), contain (letterbox), fill (stretch) */
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
  /** Output format (default: original format) */
  format?: 'jpeg' | 'png' | 'webp' | 'avif'
  /** Quality 1-100 (default: 80) */
  quality?: number
}
