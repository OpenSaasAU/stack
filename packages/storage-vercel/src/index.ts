import {
  put,
  del,
  get,
  issueSignedToken,
  presignUrl,
  BlobNotFoundError,
  PutCommandOptions,
} from '@vercel/blob'
import { randomBytes } from 'node:crypto'
import type { StorageProvider, UploadOptions, UploadResult } from '@opensaas/stack-storage'

/**
 * Configuration for Vercel Blob storage
 */
export interface VercelBlobStorageConfig {
  type: 'vercel-blob'
  /** Vercel Blob token (can also be set via BLOB_READ_WRITE_TOKEN env var) */
  token?: string
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

    // Validate token is available
    if (!config.token && !process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error(
        'Vercel Blob token is required. Set config.token or BLOB_READ_WRITE_TOKEN environment variable.',
      )
    }
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

  /**
   * Resolves the blob access level for this provider instance.
   * `public` is a provider-wide config setting, so every blob uploaded
   * (and later read) through this instance uses the same access level.
   */
  private getAccess(): 'public' | 'private' {
    return this.config.public !== false ? 'public' : 'private'
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
      access: this.getAccess(),
      token: this.config.token,
      contentType: options?.contentType,
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

    // Fetch the blob content through the SDK's authorized read path. This
    // works for both public and private blobs (private blobs cannot be
    // read via a plain `fetch(url)`, since the request needs a bearer
    // token) and resolves `null` for a missing blob instead of throwing.
    const result = await get(pathname, {
      access: this.getAccess(),
      token: this.config.token,
    })

    if (!result) {
      throw new Error(`File not found: ${filename}`)
    }

    const arrayBuffer = await new Response(result.stream).arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  async delete(filename: string): Promise<void> {
    const pathname = this.getFullPath(filename)

    try {
      await del(pathname, {
        token: this.config.token,
      })
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

  async getSignedUrl(filename: string, expiresIn: number = 3600): Promise<string> {
    const pathname = this.getFullPath(filename)
    const validUntil = Date.now() + expiresIn * 1000

    const signedToken = await issueSignedToken({
      pathname,
      operations: ['get'],
      validUntil,
      token: this.config.token,
    })

    const { presignedUrl } = await presignUrl(
      {
        delegationToken: signedToken.delegationToken,
        clientSigningToken: signedToken.clientSigningToken,
      },
      {
        operation: 'get',
        pathname,
        validUntil,
        access: this.getAccess(),
      },
    )

    return presignedUrl
  }
}

/**
 * Creates a Vercel Blob storage configuration
 *
 * @example
 * ```typescript
 * const config = config({
 *   storage: {
 *     avatars: vercelBlobStorage({
 *       token: process.env.BLOB_READ_WRITE_TOKEN,
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
