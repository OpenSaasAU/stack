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
 * Whether `name` is already a plain filename: no POSIX or Windows directory
 * separator, no NUL, and not the special `.`/`..` segments. Every method that
 * takes a caller- or database-supplied name (as opposed to one this provider
 * just generated) refuses anything that fails this check — see ADR-0006 and
 * issue #1619.
 */
function isPlainFilename(name: string): boolean {
  if (name === '' || name === '.' || name === '..') return false
  return !/[/\\\0]/.test(name)
}

/**
 * Reduce a caller-supplied name to its last path segment, splitting on both
 * `/` and `\` regardless of host OS — the traversal string itself is the
 * threat, not which platform wrote it. Used only for a fresh upload
 * (`generateUniqueFilenames: false`), where salvaging a plain basename out of
 * `../../evil.sh` is preferable to refusing the whole upload.
 */
function toBasename(name: string): string {
  return name.replace(/\0/g, '').split(/[/\\]/).pop() ?? ''
}

export class LocalStorageProvider implements StorageProvider {
  private config: LocalStorageConfig

  constructor(config: LocalStorageConfig) {
    this.config = config
  }

  private async ensureUploadDir(): Promise<void> {
    try {
      await fs.access(this.config.uploadDir)
    } catch {
      await fs.mkdir(this.config.uploadDir, { recursive: true })
    }
  }

  private generateFilename(originalFilename: string): string {
    if (this.config.generateUniqueFilenames === false) {
      const base = toBasename(originalFilename)
      if (!isPlainFilename(base)) {
        throw new Error(
          `LocalStorageProvider refused to upload an unsafe filename: ${JSON.stringify(originalFilename)}`,
        )
      }
      return base
    }

    // The extension is read off the basename, not the raw input, so a
    // traversal string cannot smuggle a separator into the generated name via
    // `path.extname`'s own POSIX/Windows quirks.
    const ext = path.extname(toBasename(originalFilename))
    const uniqueId = randomBytes(16).toString('hex')
    const timestamp = Date.now()
    return `${timestamp}-${uniqueId}${ext}`
  }

  /**
   * Resolve a stored (already-generated or caller-supplied) name against
   * `uploadDir`, refusing anything that is not a plain filename strictly
   * inside it. Returns the same `path.join`-style relative path the provider
   * has always operated on; the `path.resolve` comparison is a pure
   * containment check; the argument passed to `fs`/`getUrl` is unaffected.
   */
  private containedPath(name: string, purpose: string): string {
    if (!isPlainFilename(name)) {
      throw new Error(
        `LocalStorageProvider refused to ${purpose} outside the upload directory: ${JSON.stringify(name)}`,
      )
    }
    const candidate = path.join(this.config.uploadDir, name)
    const root = path.resolve(this.config.uploadDir)
    const resolved = path.resolve(candidate)
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(
        `LocalStorageProvider refused to ${purpose} outside the upload directory: ${JSON.stringify(name)}`,
      )
    }
    return candidate
  }

  async upload(
    file: Buffer | Uint8Array,
    filename: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    await this.ensureUploadDir()

    const generatedFilename = this.generateFilename(filename)
    const filePath = this.containedPath(generatedFilename, 'upload')

    await fs.writeFile(filePath, file)

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
    const filePath = this.containedPath(filename, 'read')
    return await fs.readFile(filePath)
  }

  async delete(filename: string): Promise<void> {
    const filePath = this.containedPath(filename, 'delete')
    try {
      await fs.unlink(filePath)
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        throw error
      }
    }
  }

  getUrl(filename: string): string {
    if (!isPlainFilename(filename)) {
      throw new Error(
        `LocalStorageProvider refused to build a URL outside the upload directory: ${JSON.stringify(filename)}`,
      )
    }
    return `${this.config.serveUrl}/${filename}`
  }
}
