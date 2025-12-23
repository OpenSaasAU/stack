import type { OpenSaasConfig, FieldConfig, RelationshipField } from '@opensaas/stack-core'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Map OpenSaas field types to Prisma field types
 */
function mapFieldTypeToPrisma(fieldName: string, field: FieldConfig): string | null {
  // Relationships are handled separately
  if (field.type === 'relationship') {
    return null
  }

  // Use field's own Prisma type generator if available
  if (field.getPrismaType) {
    const result = field.getPrismaType(fieldName)
    return result.type
  }

  // Fallback for fields without generator methods
  throw new Error(`Field type "${field.type}" does not implement getPrismaType method`)
}

/**
 * Get field modifiers (?, @default, @unique, etc.)
 */
function getFieldModifiers(fieldName: string, field: FieldConfig): string {
  // Handle relationships separately
  if (field.type === 'relationship') {
    const relField = field as RelationshipField
    if (relField.many) {
      return '[]'
    } else {
      return '?'
    }
  }

  // Use field's own Prisma type generator if available
  if (field.getPrismaType) {
    const result = field.getPrismaType(fieldName)
    return result.modifiers || ''
  }

  // Fallback for fields without generator methods
  return ''
}

/**
 * Parse relationship ref to get target list and optional field
 * Supports both 'ListName.fieldName' and 'ListName' formats
 */
function parseRelationshipRef(ref: string): { list: string; field?: string } {
  const parts = ref.split('.')
  if (parts.length === 1) {
    // List-only ref (e.g., 'Term')
    const list = parts[0]
    if (!list) {
      throw new Error(`Invalid relationship ref: ${ref}`)
    }
    return { list }
  } else if (parts.length === 2) {
    // List and field ref (e.g., 'User.posts')
    const [list, field] = parts
    if (!list || !field) {
      throw new Error(`Invalid relationship ref: ${ref}`)
    }
    return { list, field }
  } else {
    throw new Error(`Invalid relationship ref: ${ref}`)
  }
}

/**
 * Check if a relationship is one-to-one (bidirectional with both sides having many: false)
 */
function isOneToOneRelationship(
  listName: string,
  fieldName: string,
  field: RelationshipField,
  config: OpenSaasConfig,
): boolean {
  // Must be bidirectional (has target field)
  const { list: targetList, field: targetField } = parseRelationshipRef(field.ref)
  if (!targetField) {
    return false
  }

  // This side must be single (many: false or undefined)
  if (field.many) {
    return false
  }

  // Check if target list exists
  const targetListConfig = config.lists[targetList]
  if (!targetListConfig) {
    throw new Error(`Referenced list "${targetList}" not found in config`)
  }

  // Check if target field exists and is a relationship
  const targetFieldConfig = targetListConfig.fields[targetField]
  if (!targetFieldConfig) {
    throw new Error(
      `Referenced field "${targetList}.${targetField}" not found. If you want a one-sided relationship, use ref: "${targetList}" instead of ref: "${targetList}.${targetField}"`,
    )
  }
  if (targetFieldConfig.type !== 'relationship') {
    throw new Error(`Referenced field "${targetList}.${targetField}" is not a relationship field`)
  }

  const targetRelField = targetFieldConfig as RelationshipField
  return !targetRelField.many
}

/**
 * Determine if this side of a relationship should have the foreign key
 * For one-to-one relationships, only one side should have the foreign key
 */
function shouldHaveForeignKey(
  listName: string,
  fieldName: string,
  field: RelationshipField,
  config: OpenSaasConfig,
): boolean {
  // List-only refs always create foreign keys
  const { list: targetList, field: targetField } = parseRelationshipRef(field.ref)
  if (!targetField) {
    return true
  }

  // Many-side never has foreign key (it's on the one-side)
  if (field.many) {
    return false
  }

  // Check if this is a one-to-one relationship
  const isOneToOne = isOneToOneRelationship(listName, fieldName, field, config)
  if (!isOneToOne) {
    // One-to-many or many-to-one: the single side has the foreign key
    return true
  }

  // One-to-one relationship: check db.foreignKey configuration
  const targetListConfig = config.lists[targetList]!
  const targetFieldConfig = targetListConfig.fields[targetField] as RelationshipField

  const thisSideExplicit = field.db?.foreignKey
  const otherSideExplicit = targetFieldConfig.db?.foreignKey

  // Validate: both sides cannot be true
  if (thisSideExplicit === true && otherSideExplicit === true) {
    throw new Error(
      `Invalid one-to-one relationship: both "${listName}.${fieldName}" and "${targetList}.${targetField}" have db.foreignKey set to true. Only one side can store the foreign key.`,
    )
  }

  // If this side explicitly wants the foreign key, use it
  if (thisSideExplicit === true) {
    return true
  }

  // If other side explicitly wants it, don't use it on this side
  if (otherSideExplicit === true) {
    return false
  }

  // Default: use alphabetical ordering to ensure consistency
  // The "smaller" list name (alphabetically) gets the foreign key
  const comparison = listName.localeCompare(targetList)
  if (comparison !== 0) {
    return comparison < 0
  }

  // Same list (self-referential): use field name ordering
  return fieldName.localeCompare(targetField) < 0
}

/**
 * Generate Prisma schema from OpenSaas config
 */
export function generatePrismaSchema(config: OpenSaasConfig): string {
  const lines: string[] = []

  const opensaasPath = config.opensaasPath || '.opensaas'

  // Generator and datasource
  lines.push('generator client {')
  lines.push('  provider = "prisma-client"')
  lines.push(`  output   = "../${opensaasPath}/prisma-client"`)
  lines.push('}')
  lines.push('')
  lines.push('datasource db {')
  lines.push(`  provider = "${config.db.provider}"`)
  lines.push('}')
  lines.push('')

  // Track synthetic relation fields that need to be added to target lists
  // Map of listName -> array of synthetic fields
  const syntheticFields: Map<
    string,
    Array<{ fieldName: string; sourceList: string; sourceField: string; relationName: string }>
  > = new Map()

  // First pass: collect all relationship info and identify synthetic fields
  for (const [listName, listConfig] of Object.entries(config.lists)) {
    for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
      if (fieldConfig.type === 'relationship') {
        const relField = fieldConfig as RelationshipField
        const { list: targetList, field: targetField } = parseRelationshipRef(relField.ref)

        // If no target field specified, we need to add a synthetic field
        if (!targetField) {
          const syntheticFieldName = `from_${listName}_${fieldName}`
          const relationName = `${listName}_${fieldName}`

          if (!syntheticFields.has(targetList)) {
            syntheticFields.set(targetList, [])
          }
          syntheticFields.get(targetList)!.push({
            fieldName: syntheticFieldName,
            sourceList: listName,
            sourceField: fieldName,
            relationName,
          })
        }
      }
    }
  }

  // Generate models for each list
  for (const [listName, listConfig] of Object.entries(config.lists)) {
    lines.push(`model ${listName} {`)

    // Always add id field
    lines.push('  id        String   @id @default(cuid())')

    // Track relationship fields for later processing
    const relationshipFields: Array<{
      name: string
      field: RelationshipField
    }> = []

    // Add regular fields
    for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
      // Skip virtual fields - they don't create database columns
      if (fieldConfig.virtual) {
        continue
      }

      if (fieldConfig.type === 'relationship') {
        relationshipFields.push({
          name: fieldName,
          field: fieldConfig as RelationshipField,
        })
        continue
      }

      const prismaType = mapFieldTypeToPrisma(fieldName, fieldConfig)
      if (!prismaType) continue // Skip if no type returned

      const modifiers = getFieldModifiers(fieldName, fieldConfig)

      // Format with proper spacing
      const paddedName = fieldName.padEnd(12)
      lines.push(`  ${paddedName} ${prismaType}${modifiers}`)
    }

    // Add relationship fields
    for (const { name: fieldName, field: relField } of relationshipFields) {
      const { list: targetList, field: targetField } = parseRelationshipRef(relField.ref)
      const _modifiers = getFieldModifiers(fieldName, relField)
      const paddedName = fieldName.padEnd(12)

      if (relField.many) {
        // One-to-many relationship
        if (targetField) {
          // Standard bidirectional relationship
          lines.push(`  ${paddedName} ${targetList}[]`)
        } else {
          // List-only ref: use named relation
          const relationName = `${listName}_${fieldName}`
          lines.push(`  ${paddedName} ${targetList}[]  @relation("${relationName}")`)
        }
      } else {
        // Single relationship - check if this side should have the foreign key
        const hasForeignKey = shouldHaveForeignKey(listName, fieldName, relField, config)

        if (hasForeignKey) {
          // This side has the foreign key
          const foreignKeyField = `${fieldName}Id`
          const fkPaddedName = foreignKeyField.padEnd(12)

          // Check if this is a one-to-one relationship
          const isOneToOne = isOneToOneRelationship(listName, fieldName, relField, config)
          const uniqueModifier = isOneToOne ? ' @unique' : ''

          lines.push(`  ${fkPaddedName} String?${uniqueModifier}`)

          if (targetField) {
            // Standard bidirectional relationship
            lines.push(
              `  ${paddedName} ${targetList}?  @relation(fields: [${foreignKeyField}], references: [id])`,
            )
          } else {
            // List-only ref: use named relation
            const relationName = `${listName}_${fieldName}`
            lines.push(
              `  ${paddedName} ${targetList}?  @relation("${relationName}", fields: [${foreignKeyField}], references: [id])`,
            )
          }
        } else {
          // This side does NOT have the foreign key (other side of one-to-one)
          // Just add the relation field without foreign key
          lines.push(`  ${paddedName} ${targetList}?`)
        }
      }
    }

    // Add synthetic relation fields for list-only refs pointing to this list
    const syntheticFieldsForList = syntheticFields.get(listName)
    if (syntheticFieldsForList) {
      for (const {
        fieldName: syntheticFieldName,
        sourceList,
        relationName,
      } of syntheticFieldsForList) {
        const paddedName = syntheticFieldName.padEnd(12)
        lines.push(`  ${paddedName} ${sourceList}[]  @relation("${relationName}")`)
      }
    }

    // Always add timestamps
    lines.push('  createdAt DateTime @default(now())')
    lines.push('  updatedAt DateTime @updatedAt')

    lines.push('}')
    lines.push('')
  }

  let schema = lines.join('\n')

  // Apply extendPrismaSchema function if provided
  if (config.db.extendPrismaSchema) {
    schema = config.db.extendPrismaSchema(schema)
  }

  return schema
}

/**
 * Write Prisma schema to file
 */
export function writePrismaSchema(config: OpenSaasConfig, outputPath: string): void {
  const schema = generatePrismaSchema(config)

  // Ensure directory exists
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(outputPath, schema, 'utf-8')
}
