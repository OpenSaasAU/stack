import type {
  ColumnTypeDescriptor,
  DatabaseConfig,
  ListConfig,
  OpenSaasConfig,
  TypeInfo,
} from '../config/types.js'
import type { ContractIdColumn, ContractIdStrategy, ContractTimestamps } from './types.js'

export function pgType(type: string, args?: number[]): ColumnTypeDescriptor {
  return args && args.length > 0 ? { pack: 'pg', type, args } : { pack: 'pg', type }
}

export function idColumn(strategy: ContractIdStrategy): ContractIdColumn {
  switch (strategy) {
    case 'uuid7':
      return { strategy, type: pgType('uuid') }
    case 'cuid2':
      return { strategy, type: pgType('char', [24]) }
    case 'cuid':
      return { strategy, type: pgType('text') }
    case 'int autoincrement':
    case 'singleton':
      return { strategy, type: pgType('int') }
  }
}

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
  const fields = listConfig.fields ?? {}
  return {
    createdAt: !Object.prototype.hasOwnProperty.call(fields, 'createdAt'),
    updatedAt: !Object.prototype.hasOwnProperty.call(fields, 'updatedAt'),
  }
}
