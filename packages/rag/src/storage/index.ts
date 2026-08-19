import type { VectorStorage } from './types.js'
import type { VectorStorageConfig } from '../config/types.js'
import { createJsonStorage } from './json.js'
import { createPgVectorStorage } from './pgvector.js'
import { createSqliteVssStorage } from './sqlite-vss.js'

const storageFactories = new Map<string, (config: VectorStorageConfig) => VectorStorage>()

storageFactories.set('json', () => createJsonStorage())
storageFactories.set('pgvector', (config) => {
  if (config.type !== 'pgvector') {
    throw new Error('Invalid config type for pgvector storage')
  }
  return createPgVectorStorage(config as import('../config/types.js').PgVectorStorageConfig)
})
storageFactories.set('sqlite-vss', (config) => {
  if (config.type !== 'sqlite-vss') {
    throw new Error('Invalid config type for sqlite-vss storage')
  }
  return createSqliteVssStorage(config as import('../config/types.js').SqliteVssStorageConfig)
})

/**
 * @example
 * ```typescript
 * import { registerVectorStorage } from '@opensaas/stack-rag/storage'
 *
 * registerVectorStorage('pinecone', (config) => {
 *   return new PineconeVectorStorage(config)
 * })
 * ```
 */
export function registerVectorStorage(
  type: string,
  factory: (config: VectorStorageConfig) => VectorStorage,
): void {
  storageFactories.set(type, factory)
}

/**
 * @example
 * ```typescript
 * import { createVectorStorage } from '@opensaas/stack-rag/storage'
 *
 * const storage = createVectorStorage({
 *   type: 'pgvector',
 *   distanceFunction: 'cosine'
 * })
 *
 * const results = await storage.search('Article', 'contentEmbedding', queryVector, {
 *   limit: 10,
 *   context
 * })
 * ```
 */
export function createVectorStorage(config: VectorStorageConfig): VectorStorage {
  const factory = storageFactories.get(config.type)

  if (!factory) {
    throw new Error(
      `Unknown vector storage type: ${config.type}. ` +
        `Available backends: ${Array.from(storageFactories.keys()).join(', ')}`,
    )
  }

  return factory(config)
}

export * from './types.js'
export { JsonVectorStorage, createJsonStorage } from './json.js'
export { JsonFileStorage, createJsonFileStorage } from './json-file.js'
export { PgVectorStorage, createPgVectorStorage } from './pgvector.js'
export { SqliteVssStorage, createSqliteVssStorage } from './sqlite-vss.js'

export { buildAccessControlFilter, mergeAccessFilter, prismaFilterToSQL } from './access-filter.js'
