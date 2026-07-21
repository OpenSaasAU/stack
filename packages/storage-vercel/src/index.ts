import { put, del, get, issueSignedToken, presignUrl, BlobNotFoundError } from '@vercel/blob'
import type { PutCommandOptions } from '@vercel/blob'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type { StorageProvider, UploadOptions, UploadResult } from '@opensaas/stack-storage'

/**
 * Derives the store ID embedded in a Vercel Blob read-write token
 * (`vercel_blob_rw_<storeId>_<secret>`), the same way `@vercel/blob` derives
 * it internally to build blob URLs. This format is undocumented and not a
 * stable public API — it's parity with the SDK's internal parsing, not a
 * contract Vercel guarantees. Returns `''` if the token doesn't match the
 * expected shape.
 */
function parseStoreIdFromToken(token: string): string {
  const segments = token.split('_')
  return segments.length >= 4 ? segments[3] : ''
}

/** Strips the `store_` prefix some store ID values are given with. */
function normalizeStoreId(storeId: string): string {
  return storeId.startsWith('store_') ? storeId.slice('store_'.length) : storeId
}

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
  /**
   * Whether to allow overwriting an existing blob at the same pathname.
   * The Blob API rejects overwrites unless this is sent. Defaults to `true`
   * when `generateUniqueFilenames` is `false` (stable filenames imply replace
   * semantics), and `false` otherwise. An explicit setting always wins.
   */
  allowOverwrite?: boolean
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

    const ext = path.extname(originalFilename)
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
   * Resolves whether uploads may overwrite an existing blob at the same
   * pathname. An explicit `allowOverwrite` always wins; otherwise stable
   * filenames (`generateUniqueFilenames: false`) imply replace semantics and
   * default to `true`. With generated filenames collisions aren't expected,
   * so the key is left unset and the Blob API's own reject-by-default
   * behavior applies.
   */
  private resolveAllowOverwrite(): boolean | undefined {
    if (this.config.allowOverwrite !== undefined) {
      return this.config.allowOverwrite
    }
    return this.config.generateUniqueFilenames === false ? true : undefined
  }

  /**
   * Resolves the blob access level for this provider instance.
   * `public` is a provider-wide config setting, so every blob uploaded
   * (and later read) through this instance uses the same access level.
   */
  private getAccess(): 'public' | 'private' {
    return this.config.public !== false ? 'public' : 'private'
  }

  /**
   * Resolves the Vercel Blob store ID used to construct blob URLs, mirroring
   * the SDK's own credential precedence: an explicit read-write token wins
   * (its embedded store ID is authoritative), otherwise an explicit/env store
   * ID is used, otherwise the store ID is parsed from the env read-write
   * token.
   */
  private resolveStoreId(): string {
    const token = this.config.token ?? process.env.BLOB_READ_WRITE_TOKEN?.trim()
    if (this.config.token) {
      const storeId = parseStoreIdFromToken(this.config.token)
      if (!storeId) {
        throw new Error(
          'Cannot determine the Vercel Blob store ID: the configured `token` does not match the ' +
            'expected "vercel_blob_rw_<storeId>_<secret>" format. Pass `storeId` explicitly to construct blob URLs.',
        )
      }
      return storeId
    }

    const storeId = this.config.storeId?.trim() || process.env.BLOB_STORE_ID?.trim()
    if (storeId) {
      return normalizeStoreId(storeId)
    }

    if (token) {
      const parsedStoreId = parseStoreIdFromToken(token)
      if (!parsedStoreId) {
        throw new Error(
          'Cannot determine the Vercel Blob store ID: BLOB_READ_WRITE_TOKEN does not match the ' +
            'expected "vercel_blob_rw_<storeId>_<secret>" format. Pass `storeId` explicitly to construct blob URLs.',
        )
      }
      return parsedStoreId
    }

    throw new Error(
      'Cannot determine the Vercel Blob store ID: configure `token`, `storeId`, BLOB_STORE_ID, or ' +
        'BLOB_READ_WRITE_TOKEN to construct blob URLs.',
    )
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
      contentType: options?.contentType,
      ...this.authOptions(),
    }

    if (this.config.cacheControlMaxAge !== undefined) {
      uploadOptions.cacheControlMaxAge = this.config.cacheControlMaxAge
    }

    const allowOverwrite = this.resolveAllowOverwrite()
    if (allowOverwrite !== undefined) {
      uploadOptions.allowOverwrite = allowOverwrite
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
      ...this.authOptions(),
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
      await del(pathname, this.authOptions())
    } catch (error) {
      if (!(error instanceof BlobNotFoundError)) {
        throw error
      }
    }
  }

  getUrl(filename: string): string {
    const pathname = this.getFullPath(filename)
    const storeId = this.resolveStoreId()
    return `https://${storeId}.${this.getAccess()}.blob.vercel-storage.com/${pathname}`
  }

  async getSignedUrl(filename: string, expiresIn: number = 3600): Promise<string> {
    const pathname = this.getFullPath(filename)
    const validUntil = Date.now() + expiresIn * 1000

    const signedToken = await issueSignedToken({
      pathname,
      operations: ['get'],
      validUntil,
      ...this.authOptions(),
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
