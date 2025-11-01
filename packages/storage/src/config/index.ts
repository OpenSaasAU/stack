import type { LocalStorageConfig } from './types.js'

export * from './types.js'

/**
 * Creates a local filesystem storage configuration
 *
 * @example
 * ```typescript
 * const config = config({
 *   storage: {
 *     documents: localStorage({
 *       uploadDir: './uploads/documents',
 *       serveUrl: '/api/files',
 *     }),
 *   },
 * })
 * ```
 */
export function localStorage(
  config: Pick<LocalStorageConfig, 'uploadDir' | 'serveUrl'> & Partial<Pick<LocalStorageConfig, 'generateUniqueFilenames'>>
): LocalStorageConfig {
  return {
    type: 'local',
    uploadDir: config.uploadDir,
    serveUrl: config.serveUrl,
    generateUniqueFilenames: config.generateUniqueFilenames ?? true,
  }
}
