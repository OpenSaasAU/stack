/**
 * Schema generator - converts OpenSaas config to table definitions
 */
import type { OpenSaasConfig, FieldConfig, RelationshipField } from '@opensaas/stack-core'
import type { TableDefinition, ColumnDefinition, RelationshipMap } from '../types/index.js'

/**
 * Map OpenSaas field types to database column types
 */
function mapFieldType(fieldConfig: FieldConfig): ColumnDefinition['type'] {
  switch (fieldConfig.type) {
    case 'text':
    case 'password':
    case 'select':
      return 'TEXT'

    case 'integer':
      return 'INTEGER'

    case 'checkbox':
      return 'BOOLEAN'

    case 'timestamp':
      return 'TIMESTAMP'

    case 'relationship':
      // Relationships don't create direct columns (foreign keys are handled separately)
      return 'TEXT'

    default:
      // For unknown types (e.g., custom fields), default to TEXT
      return 'TEXT'
  }
}

/**
 * Parse relationship ref to get target list and field
 */
function parseRelationshipRef(ref: string): { list: string; field: string } {
  const [list, field] = ref.split('.')
  if (!list || !field) {
    throw new Error(`Invalid relationship ref: ${ref}`)
  }
  return { list, field }
}

/**
 * Generate table definitions from OpenSaas config
 */
export function generateTableDefinitions(config: OpenSaasConfig): TableDefinition[] {
  const tables: TableDefinition[] = []

  for (const [listName, listConfig] of Object.entries(config.lists)) {
    const columns: ColumnDefinition[] = []

    // Always add system fields
    columns.push({
      name: 'id',
      type: 'TEXT',
      primaryKey: true,
    })

    columns.push({
      name: 'createdAt',
      type: 'TIMESTAMP',
      nullable: false,
    })

    columns.push({
      name: 'updatedAt',
      type: 'TIMESTAMP',
      nullable: false,
    })

    // Add fields from config
    for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
      if (fieldConfig.type === 'relationship') {
        const relField = fieldConfig as RelationshipField

        // Only create foreign key column for many-to-one relationships
        if (!relField.many) {
          const { list: targetList } = parseRelationshipRef(relField.ref)

          columns.push({
            name: `${fieldName}Id`,
            type: 'TEXT',
            nullable: true,
            references: {
              table: targetList,
              column: 'id',
              onDelete: 'SET NULL', // Can be configured later
            },
          })
        }
        // One-to-many relationships don't need a column on this table
      } else {
        const columnType = mapFieldType(fieldConfig)

        // Check if field is required
        const isRequired = fieldConfig.validation?.isRequired === true

        columns.push({
          name: fieldName,
          type: columnType,
          nullable: !isRequired,
        })
      }
    }

    tables.push({
      name: listName,
      columns,
    })
  }

  return tables
}

/**
 * Generate SQL CREATE TABLE statements
 */
export function generateCreateTableSQL(
  tables: TableDefinition[],
  quoteIdentifier: (name: string) => string,
  mapColumnType: (type: ColumnDefinition['type']) => string,
): string[] {
  return tables.map((table) => {
    const columnDefs = table.columns.map((col) => {
      const parts: string[] = [quoteIdentifier(col.name)]

      parts.push(mapColumnType(col.type))

      if (col.primaryKey) {
        parts.push('PRIMARY KEY')
      }

      if (!col.nullable && !col.primaryKey) {
        parts.push('NOT NULL')
      }

      if (col.unique) {
        parts.push('UNIQUE')
      }

      if (col.default !== undefined) {
        if (typeof col.default === 'string') {
          parts.push(`DEFAULT '${col.default}'`)
        } else {
          parts.push(`DEFAULT ${col.default}`)
        }
      }

      return '  ' + parts.join(' ')
    })

    // Add foreign key constraints
    const foreignKeys = table.columns
      .filter((col) => col.references)
      .map((col) => {
        const ref = col.references!
        const onDelete = ref.onDelete ? ` ON DELETE ${ref.onDelete}` : ''
        return `  FOREIGN KEY (${quoteIdentifier(col.name)}) REFERENCES ${quoteIdentifier(ref.table)}(${quoteIdentifier(ref.column)})${onDelete}`
      })

    const allDefs = [...columnDefs, ...foreignKeys]

    return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table.name)} (\n${allDefs.join(',\n')}\n);`
  })
}

/**
 * Generate relationship maps for all tables
 */
export function generateRelationshipMaps(config: OpenSaasConfig): Record<string, RelationshipMap> {
  const relationshipMaps: Record<string, RelationshipMap> = {}

  for (const [listName, listConfig] of Object.entries(config.lists)) {
    const relationships: RelationshipMap = {}

    for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
      if (fieldConfig.type === 'relationship') {
        const relField = fieldConfig as RelationshipField
        const { list: targetList, field: targetField } = parseRelationshipRef(relField.ref)

        if (relField.many) {
          // One-to-many: foreign key is on the target table
          relationships[fieldName] = {
            name: fieldName,
            type: 'one-to-many',
            targetTable: targetList,
            foreignKey: `${fieldName}Id`, // The FK on the target table
            targetField: targetField,
          }
        } else {
          // Many-to-one: foreign key is on this table
          relationships[fieldName] = {
            name: fieldName,
            type: 'many-to-one',
            targetTable: targetList,
            foreignKey: `${fieldName}Id`, // The FK on this table
            targetField: targetField,
          }
        }
      }
    }

    relationshipMaps[listName] = relationships
  }

  return relationshipMaps
}
