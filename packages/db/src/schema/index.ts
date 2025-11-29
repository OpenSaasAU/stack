/**
 * Schema generation
 */
export {
  generateTableDefinitions,
  generateCreateTableSQL,
  generateRelationshipMaps,
} from './generator.js'
export type { TableDefinition, ColumnDefinition, RelationshipMap } from '../types/index.js'
