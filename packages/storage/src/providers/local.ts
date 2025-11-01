import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import type {
  StorageProvider,
  UploadOptions,
  UploadResult,
  LocalStorageConfig,
} from '../config/types.js'

/**
 * Local filesystem storage provider
 * Stores files on the local filesystem
 */
export class LocalStorageProvider implements StorageProvider {
  private config: LocalStorageConfig

  constructor(config: LocalStorageConfig) {
    this.config = config
  }

  /**
   * Ensures the upload directory exists
   */
  private async ensureUploadDir(): Promise<void> {
    try {
      await fs.access(this.config.uploadDir)
    } catch {
      await fs.mkdir(this.config.uploadDir, { recursive: true })
    }
  }

  /**
   * Generates a unique filename if configured
   */
  private generateFilename(originalFilename: string): string {
    if (this.config.generateUniqueFilenames === false) {
      return originalFilename
    }

    const ext = path.extname(originalFilename)
    const uniqueId = randomBytes(16).toString('hex')
    const timestamp = Date.now()
    return `${timestamp}-${uniqueId}${ext}`
  }

  async upload(
    file: Buffer | Uint8Array,
    filename: string,
    options?: UploadOptions
  ): Promise<UploadResult> {
    await this.ensureUploadDir()

    const generatedFilename = this.generateFilename(filename)
    const filePath = path.join(this.config.uploadDir, generatedFilename)

    // Write file to disk
    await fs.writeFile(filePath, file)

    // Get file stats for size
    const stats = await fs.stat(filePath)

    return {
      filename: generatedFilename,
      url: `${this.config.serveUrl}/${generatedFilename}`,
      size: stats.size,
      contentType: options?.contentType || 'application/octet-stream',
      metadata: options?.metadata,
    }
  }

  async download(filename: string): Promise<Buffer> {
    const filePath = path.join(this.config.uploadDir, filename)
    return await fs.readFile(filePath)
  }

  async delete(filename: string): Promise<void> {
    const filePath = path.join(this.config.uploadDir, filename)
    await fs.unlink(filePath)
  }

  getUrl(filename: string): string {
    return `${this.config.serveUrl}/${filename}`
  }
}
