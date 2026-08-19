/**
 * Storage provider interface that all storage backends must implement.
 * This allows pluggable storage solutions (local, S3, Vercel Blob, etc.)
 */
export interface StorageProvider {
  /** Uploads a file. `filename` may be transformed by the provider (e.g. to guarantee uniqueness). */
  upload(
    file: Buffer | Uint8Array,
    filename: string,
    options?: UploadOptions,
  ): Promise<UploadResult>

  download(filename: string): Promise<Buffer>

  /**
   * Deletes a file from the storage provider.
   *
   * Idempotent: deleting a filename that doesn't exist in the backing store
   * resolves without error. Only non-not-found errors (permissions, network,
   * etc.) should reject.
   */
  delete(filename: string): Promise<void>

  getUrl(filename: string): string

  /** Gets a signed URL for private files. */
  getSignedUrl?(filename: string, expiresIn?: number): Promise<string>
}

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

export interface BaseStorageConfig {
  type: string
  [key: string]: unknown
}

/** Maps names to storage provider configs, e.g. `{ avatars: s3Config, documents: localConfig }`. */
export type StorageConfig = Record<string, BaseStorageConfig | LocalStorageConfig>

// Defined in @opensaas/stack-core, not here, to avoid circular dependencies.
export type {
  FileMetadata,
  ImageMetadata,
  ImageTransformationResult,
} from '@opensaas/stack-core/internal'

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
