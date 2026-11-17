import type { DatabaseConfig, ListConfig, OpenSaasConfig, TypeInfo } from '../config/types.js'
import type { ContractIdStrategy, ContractTimestamps } from './types.js'

export function resolveIdStrategy(
  listConfig: ListConfig<TypeInfo>,
  config: OpenSaasConfig,
): ContractIdStrategy {
  if (listConfig.isSingleton) return 'singleton'
  return listConfig.db?.idField ?? config.db.idField ?? 'uuid7'
}

/**
 * Which auto-timestamp columns a list carries: `db.timestamps` per list over
 * the config default, off by default (ADR-0004). A declared `createdAt`/
 * `updatedAt` field replaces the auto-timestamp column, as the generator has
 * always allowed.
 */
export function resolveListTimestamps(
  listConfig: ListConfig<TypeInfo>,
  dbConfig: DatabaseConfig,
): ContractTimestamps {
  const enabled = listConfig.db?.timestamps ?? dbConfig.timestamps ?? false
  if (!enabled) return { createdAt: false, updatedAt: false }
  return {
    createdAt: !Object.prototype.hasOwnProperty.call(listConfig.fields, 'createdAt'),
    updatedAt: !Object.prototype.hasOwnProperty.call(listConfig.fields, 'updatedAt'),
  }
}
