import { put, del, head, BlobNotFoundError } from '@vercel/blob'
import type { PutCommandOptions } from '@vercel/blob'
import { randomBytes } from 'node:crypto'
import type { StorageProvider, UploadOptions, UploadResult } from '@opensaas/stack-storage'

/**
 * Configuration for Vercel Blob storage
 */
export interface VercelBlobStorageConfig {
  type: 'vercel-blob'
  /**
   * Vercel Blob read-write token (can also be set via BLOB_READ_WRITE_TOKEN env var).
   * Optional when using Vercel OIDC auth (`storeId`/`BLOB_STORE_ID`).
   */
  token?: string
  /**
   * Blob store id for Vercel OIDC auth (overrides the BLOB_STORE_ID env var).
   * When an OIDC token is available (VERCEL_OIDC_TOKEN or `oidcToken`) and a
   * store id is set, no static read-write token is needed.
   */
  storeId?: string
  /**
   * Explicit Vercel OIDC token (overrides the VERCEL_OIDC_TOKEN env var).
   * Requires `storeId` or BLOB_STORE_ID.
   */
  oidcToken?: string
  /** Whether to generate unique filenames (default: true) */
  generateUniqueFilenames?: boolean
  /** Path prefix for all uploaded files */
  pathPrefix?: string
  /** Whether files should be publicly accessible (default: true) */
  public?: boolean
  /** Cache control header (default: 'public, max-age=31536000, immutable') */
  cacheControlMaxAge?: number
  /** Allow additional properties */
  [key: string]: unknown
}

/**
 * Vercel Blob storage provider
 */
export class VercelBlobStorageProvider implements StorageProvider {
  private config: VercelBlobStorageConfig

  constructor(config: VercelBlobStorageConfig) {
    this.config = config
    // Credential resolution is delegated to the @vercel/blob SDK at call time.
    // Eagerly requiring a static token here would break Vercel OIDC auth, where
    // no token/BLOB_READ_WRITE_TOKEN exists and the SDK resolves credentials
    // from VERCEL_OIDC_TOKEN (or the request context) plus storeId/BLOB_STORE_ID.
  }

  /**
   * Credential options passed to every SDK call. The SDK's precedence is:
   * explicit `token` → OIDC token + store id → BLOB_READ_WRITE_TOKEN env var;
   * it throws a descriptive error when none of these are available.
   */
  private authOptions(): { token?: string; storeId?: string; oidcToken?: string } {
    const auth: { token?: string; storeId?: string; oidcToken?: string } = {}
    if (this.config.token) auth.token = this.config.token
    if (this.config.storeId) auth.storeId = this.config.storeId
    if (this.config.oidcToken) auth.oidcToken = this.config.oidcToken
    return auth
  }

  /**
   * Generates a unique filename if configured
   */
  private generateFilename(originalFilename: string): string {
    if (this.config.generateUniqueFilenames === false) {
      return originalFilename
    }

    const ext = originalFilename.substring(originalFilename.lastIndexOf('.'))
    const uniqueId = randomBytes(16).toString('hex')
    const timestamp = Date.now()
    return `${timestamp}-${uniqueId}${ext}`
  }

  /**
   * Gets the full pathname for a file including path prefix
   */
  private getFullPath(filename: string): string {
    if (this.config.pathPrefix) {
      return `${this.config.pathPrefix}/${filename}`
    }
    return filename
  }

  async upload(
    file: Buffer | Uint8Array,
    filename: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    const generatedFilename = this.generateFilename(filename)
    const pathname = this.getFullPath(generatedFilename)

    // Convert Uint8Array to Buffer if needed
    const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file)

    // Upload to Vercel Blob
    const uploadOptions: PutCommandOptions = {
      access: 'public',
      contentType: options?.contentType,
      ...this.authOptions(),
    }

    if (this.config.public !== false) {
      uploadOptions.access = 'public'
    }

    if (this.config.cacheControlMaxAge) {
      uploadOptions.cacheControlMaxAge = this.config.cacheControlMaxAge
    }

    const blob = await put(pathname, buffer, uploadOptions)

    return {
      filename: generatedFilename,
      url: blob.url,
      size: file.length,
      contentType: options?.contentType || 'application/octet-stream',
      metadata: {
        ...options?.metadata,
        downloadUrl: blob.downloadUrl,
        pathname: blob.pathname,
      },
    }
  }

  async download(filename: string): Promise<Buffer> {
    const pathname = this.getFullPath(filename)

    // Get blob metadata to retrieve URL
    let metadata
    try {
      metadata = await head(pathname, this.authOptions())
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        throw new Error(`File not found: ${filename}`)
      }
      throw error
    }

    // Fetch the file content
    const response = await fetch(metadata.url)

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  async delete(filename: string): Promise<void> {
    const pathname = this.getFullPath(filename)

    try {
      await del(pathname, this.authOptions())
    } catch (error) {
      if (!(error instanceof BlobNotFoundError)) {
        throw error
      }
    }
  }

  getUrl(filename: string): string {
    // For Vercel Blob, we need to have uploaded the file first to get the URL
    // This method is less useful for Vercel Blob, but we provide a pathname
    const pathname = this.getFullPath(filename)
    return `https://blob.vercel-storage.com/${pathname}`
  }
}

/**
 * Creates a Vercel Blob storage configuration
 *
 * @example
 * ```typescript
 * // Static read-write token
 * const config = config({
 *   storage: {
 *     avatars: vercelBlobStorage({
 *       token: process.env.BLOB_READ_WRITE_TOKEN,
 *       pathPrefix: 'avatars',
 *     }),
 *   },
 * })
 *
 * // Vercel OIDC auth — no static token; the SDK resolves credentials from
 * // VERCEL_OIDC_TOKEN plus the store id (config.storeId or BLOB_STORE_ID env)
 * const config = config({
 *   storage: {
 *     avatars: vercelBlobStorage({
 *       storeId: process.env.BLOB_STORE_ID,
 *       pathPrefix: 'avatars',
 *     }),
 *   },
 * })
 * ```
 */
export function vercelBlobStorage(
  config: Omit<VercelBlobStorageConfig, 'type'>,
): VercelBlobStorageConfig {
  return {
    type: 'vercel-blob',
    generateUniqueFilenames: true,
    public: true,
    ...config,
  }
}
