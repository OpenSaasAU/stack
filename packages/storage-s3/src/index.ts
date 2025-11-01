import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomBytes } from 'node:crypto'
import type {
  StorageProvider,
  UploadOptions,
  UploadResult,
} from '@opensaas/stack-storage'

/**
 * Configuration for S3 storage
 */
export interface S3StorageConfig {
  type: 's3'
  /** S3 bucket name */
  bucket: string
  /** AWS region */
  region: string
  /** AWS access key ID (optional if using IAM role) */
  accessKeyId?: string
  /** AWS secret access key (optional if using IAM role) */
  secretAccessKey?: string
  /** Custom endpoint for S3-compatible services (e.g., MinIO, Backblaze) */
  endpoint?: string
  /** Force path style URLs (required for some S3-compatible services) */
  forcePathStyle?: boolean
  /** Base path prefix for all uploaded files */
  pathPrefix?: string
  /** Whether to generate unique filenames (default: true) */
  generateUniqueFilenames?: boolean
  /** ACL for uploaded files (default: 'private') */
  acl?: 'private' | 'public-read' | 'public-read-write' | 'authenticated-read'
  /** Custom domain for public URLs (e.g., 'https://cdn.example.com') */
  customDomain?: string
}

/**
 * AWS S3 storage provider
 * Supports standard S3 and S3-compatible services
 */
export class S3StorageProvider implements StorageProvider {
  private client: S3Client
  private config: S3StorageConfig

  constructor(config: S3StorageConfig) {
    this.config = config

    // Create S3 client
    this.client = new S3Client({
      region: config.region,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            }
          : undefined,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
    })
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
   * Gets the full key for an object including path prefix
   */
  private getFullKey(filename: string): string {
    if (this.config.pathPrefix) {
      return `${this.config.pathPrefix}/${filename}`
    }
    return filename
  }

  async upload(
    file: Buffer | Uint8Array,
    filename: string,
    options?: UploadOptions
  ): Promise<UploadResult> {
    const generatedFilename = this.generateFilename(filename)
    const key = this.getFullKey(generatedFilename)

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: file,
      ContentType: options?.contentType,
      Metadata: options?.metadata,
      ACL: this.config.acl || 'private',
      CacheControl: options?.cacheControl,
    })

    await this.client.send(command)

    // Generate URL
    const url = this.getUrl(generatedFilename)

    return {
      filename: generatedFilename,
      url,
      size: file.length,
      contentType: options?.contentType || 'application/octet-stream',
      metadata: options?.metadata,
    }
  }

  async download(filename: string): Promise<Buffer> {
    const key = this.getFullKey(filename)

    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    })

    const response = await this.client.send(command)

    if (!response.Body) {
      throw new Error(`File not found: ${filename}`)
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = []
    const stream = response.Body as any

    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    return Buffer.concat(chunks)
  }

  async delete(filename: string): Promise<void> {
    const key = this.getFullKey(filename)

    const command = new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    })

    await this.client.send(command)
  }

  getUrl(filename: string): string {
    const key = this.getFullKey(filename)

    // Use custom domain if configured
    if (this.config.customDomain) {
      return `${this.config.customDomain}/${key}`
    }

    // Use standard S3 URL
    if (this.config.endpoint) {
      // Custom endpoint (S3-compatible services)
      return `${this.config.endpoint}/${this.config.bucket}/${key}`
    }

    // Standard AWS S3 URL
    return `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${key}`
  }

  async getSignedUrl(filename: string, expiresIn: number = 3600): Promise<string> {
    const key = this.getFullKey(filename)

    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    })

    return await getSignedUrl(this.client, command, { expiresIn })
  }
}

/**
 * Creates an S3 storage configuration
 *
 * @example
 * ```typescript
 * const config = config({
 *   storage: {
 *     avatars: s3Storage({
 *       bucket: 'my-avatars',
 *       region: 'us-east-1',
 *       accessKeyId: process.env.AWS_ACCESS_KEY_ID,
 *       secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
 *     }),
 *   },
 * })
 * ```
 */
export function s3Storage(config: Omit<S3StorageConfig, 'type'>): S3StorageConfig {
  return {
    type: 's3',
    generateUniqueFilenames: true,
    acl: 'private',
    ...config,
  }
}
