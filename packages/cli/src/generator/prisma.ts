import type { OpenSaasConfig, FieldConfig, RelationshipField } from '@opensaas/stack-core'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Map OpenSaas field types to Prisma field types
 */
function mapFieldTypeToPrisma(
  fieldName: string,
  field: FieldConfig,
  provider?: string,
): string | null {
  // Relationships are handled separately
  if (field.type === 'relationship') {
    return null
  }

  // Use field's own Prisma type generator if available
  if (field.getPrismaType) {
    const result = field.getPrismaType(fieldName, provider)
    return result.type
  }

  // Fallback for fields without generator methods
  throw new Error(`Field type "${field.type}" does not implement getPrismaType method`)
}

/**
 * Get field modifiers (?, @default, @unique, etc.)
 */
function getFieldModifiers(fieldName: string, field: FieldConfig, provider?: string): string {
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
    const result = field.getPrismaType(fieldName, provider)
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
 * Represents a many-to-many relationship between two lists
 */
type ManyToManyRelationship = {
  sourceList: string
  sourceField: string
  targetList: string
  targetField?: string
  // The side that owns the join table name (for deterministic naming)
  ownerSide: 'source' | 'target'
  // The join table name (e.g., _Lesson_teachers)
  joinTableName: string
  // The relation name for Prisma
  relationName: string
}

/**
 * Check if a relationship field is many-to-many
 */
function isManyToManyRelationship(
  listName: string,
  fieldName: string,
  field: RelationshipField,
  config: OpenSaasConfig,
): { isManyToMany: boolean; targetList: string; targetField?: string } {
  // Must be a many relationship
  if (!field.many) {
    return { isManyToMany: false, targetList: '', targetField: undefined }
  }

  const { list: targetList, field: targetField } = parseRelationshipRef(field.ref)

  // List-only refs with many: true are many-to-many (implicit single on other side)
  if (!targetField) {
    return { isManyToMany: true, targetList, targetField: undefined }
  }

  // Check if target field exists and is also many
  const targetListConfig = config.lists[targetList]
  if (!targetListConfig) {
    // Target list doesn't exist - not a valid many-to-many
    // (error will be thrown by existing validation code)
    return { isManyToMany: false, targetList, targetField }
  }

  const targetFieldConfig = targetListConfig.fields[targetField]
  if (!targetFieldConfig) {
    // Target field doesn't exist - not a valid many-to-many
    // (error will be thrown by existing validation code if needed)
    return { isManyToMany: false, targetList, targetField }
  }

  if (targetFieldConfig.type !== 'relationship') {
    // Target field is not a relationship - not a valid many-to-many
    return { isManyToMany: false, targetList, targetField }
  }

  const targetRelField = targetFieldConfig as RelationshipField

  // Both sides must have many: true for many-to-many
  return { isManyToMany: !!targetRelField.many, targetList, targetField }
}

/**
 * Generate Prisma schema from OpenSaas config
 */
export function generatePrismaSchema(config: OpenSaasConfig): string {
  const lines: string[] = []

  const opensaasPath = config.opensaasPath || '.opensaas'
  const joinTableNaming = config.db.joinTableNaming || 'prisma'

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

  // Track many-to-many relationships (for Keystone naming)
  const manyToManyRelationships: ManyToManyRelationship[] = []

  // Track synthetic relation fields that need to be added to target lists
  // Map of listName -> array of synthetic fields
  const syntheticFields: Map<
    string,
    Array<{ fieldName: string; sourceList: string; sourceField: string; relationName: string }>
  > = new Map()

  // First pass: collect all relationship info and identify synthetic fields and many-to-many relationships
  const processedManyToMany = new Set<string>() // Track processed many-to-many to avoid duplicates

  for (const [listName, listConfig] of Object.entries(config.lists)) {
    for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
      if (fieldConfig.type === 'relationship') {
        const relField = fieldConfig as RelationshipField
        const { list: targetList, field: targetField } = parseRelationshipRef(relField.ref)

        // Check if this is a many-to-many relationship (only if it's a many relationship)
        const m2mCheck = relField.many
          ? isManyToManyRelationship(listName, fieldName, relField, config)
          : { isManyToMany: false, targetList: '', targetField: undefined }

        if (m2mCheck.isManyToMany) {
          // Create a unique key to avoid processing the same relationship twice
          const relationshipKey = targetField
            ? // Bidirectional: use sorted list names to ensure uniqueness
              [listName, fieldName, targetList, targetField].sort().join('.')
            : // List-only: just use source side
              `${listName}.${fieldName}`

          if (!processedManyToMany.has(relationshipKey)) {
            processedManyToMany.add(relationshipKey)

            // Check for per-field relationName (takes precedence)
            const sourceRelationName = relField.db?.relationName
            let targetRelationName: string | undefined

            if (targetField) {
              const targetListConfig = config.lists[targetList]
              const targetFieldConfig = targetListConfig?.fields[targetField]
              if (targetFieldConfig?.type === 'relationship') {
                targetRelationName = (targetFieldConfig as RelationshipField).db?.relationName
              }
            }

            // Validate both sides match if both specify relationName
            if (sourceRelationName && targetRelationName && sourceRelationName !== targetRelationName) {
              throw new Error(
                `Relation name mismatch: ${listName}.${fieldName} has relationName "${sourceRelationName}" but ${targetList}.${targetField} has "${targetRelationName}". Both sides must use the same relationName.`,
              )
            }

            // Use per-field relationName if set (either side), otherwise fall back to global naming
            const explicitRelationName = sourceRelationName || targetRelationName
            let relationName: string
            let joinTableName: string
            let ownerSide: 'source' | 'target' = 'source'

            if (explicitRelationName) {
              // Per-field relationName takes precedence
              relationName = explicitRelationName
              joinTableName = `_${explicitRelationName}`
            } else if (joinTableNaming === 'keystone') {
              // For Keystone naming, we need to determine which side owns the join table name
              // Keystone uses the side where the relationship is defined
              // For bidirectional many-to-many, we need to pick one side deterministically
              joinTableName = `_${listName}_${fieldName}`
              relationName = `${listName}_${fieldName}`

              if (targetField) {
                // Bidirectional many-to-many
                // Use alphabetical ordering to determine owner (ensures both sides agree)
                const sourceKey = `${listName}.${fieldName}`
                const targetKey = `${targetList}.${targetField}`

                if (sourceKey.localeCompare(targetKey) < 0) {
                  ownerSide = 'source'
                  joinTableName = `_${listName}_${fieldName}`
                  relationName = `${listName}_${fieldName}`
                } else {
                  ownerSide = 'target'
                  joinTableName = `_${targetList}_${targetField}`
                  relationName = `${targetList}_${targetField}`
                }
              }
            } else {
              // Default Prisma naming - no explicit relation name needed
              // Prisma will auto-generate join table name
              relationName = ''
              joinTableName = ''
            }

            // Only track M2M relationships that need explicit relation names
            if (relationName) {
              manyToManyRelationships.push({
                sourceList: listName,
                sourceField: fieldName,
                targetList,
                targetField,
                ownerSide,
                joinTableName,
                relationName,
              })
            }
          }
        }

        // If no target field specified, we need to add a synthetic field
        // (unless per-field relationName is set or global Keystone naming is enabled)
        const hasExplicitRelationName = relField.db?.relationName
        if (!targetField && !hasExplicitRelationName && joinTableNaming !== 'keystone') {
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

    // Track foreign key fields that need indexes
    const foreignKeyIndexes: Array<{
      foreignKeyField: string
      indexType: boolean | 'unique'
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

      const prismaType = mapFieldTypeToPrisma(fieldName, fieldConfig, config.db.provider)
      if (!prismaType) continue // Skip if no type returned

      const modifiers = getFieldModifiers(fieldName, fieldConfig, config.db.provider)

      // Format with proper spacing
      const paddedName = fieldName.padEnd(12)
      lines.push(`  ${paddedName} ${prismaType}${modifiers}`)
    }

    // Add relationship fields
    for (const { name: fieldName, field: relField } of relationshipFields) {
      const { list: targetList, field: targetField } = parseRelationshipRef(relField.ref)
      const paddedName = fieldName.padEnd(12)

      if (relField.many) {
        // Check if this is a many-to-many relationship
        const m2mCheck = isManyToManyRelationship(listName, fieldName, relField, config)

        let relationLine: string

        // Check if this M2M relationship has an explicit relation name (per-field or global Keystone naming)
        const m2mRel = manyToManyRelationships.find(
          (rel) =>
            (rel.sourceList === listName && rel.sourceField === fieldName) ||
            (rel.targetList === listName && rel.targetField === fieldName),
        )

        if (m2mCheck.isManyToMany && m2mRel) {
          // Many-to-many with explicit relation name (per-field or Keystone naming)
          relationLine = `  ${paddedName} ${targetList}[]  @relation("${m2mRel.relationName}")`
        } else if (targetField) {
          // Standard bidirectional one-to-many or many-to-many with Prisma naming
          relationLine = `  ${paddedName} ${targetList}[]`
        } else {
          // List-only ref: use named relation
          const relationName = `${listName}_${fieldName}`
          relationLine = `  ${paddedName} ${targetList}[]  @relation("${relationName}")`
        }

        // Apply extendPrismaSchema if defined (many side has no FK line)
        if (relField.db?.extendPrismaSchema) {
          const extended = relField.db.extendPrismaSchema({ relationLine })
          relationLine = extended.relationLine
        }

        lines.push(relationLine)
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

          // Get the map attribute
          // If foreignKey is an object with map property, use it
          // Otherwise, default to fieldName (not fieldNameId)
          let mapModifier = ''
          if (typeof relField.db?.foreignKey === 'object' && relField.db.foreignKey.map) {
            mapModifier = ` @map("${relField.db.foreignKey.map}")`
          } else {
            // Default to field name (not fieldNameId)
            mapModifier = ` @map("${fieldName}")`
          }

          let fkLine = `  ${fkPaddedName} String?${uniqueModifier}${mapModifier}`
          let relationLine: string

          if (targetField) {
            // Standard bidirectional relationship
            relationLine = `  ${paddedName} ${targetList}?  @relation(fields: [${foreignKeyField}], references: [id])`
          } else {
            // List-only ref: use named relation
            const relationName = `${listName}_${fieldName}`
            relationLine = `  ${paddedName} ${targetList}?  @relation("${relationName}", fields: [${foreignKeyField}], references: [id])`
          }

          // Apply extendPrismaSchema if defined
          if (relField.db?.extendPrismaSchema) {
            const extended = relField.db.extendPrismaSchema({ fkLine, relationLine })
            fkLine = extended.fkLine ?? fkLine
            relationLine = extended.relationLine
          }

          lines.push(fkLine)
          lines.push(relationLine)

          // Track foreign key for index generation
          // Default to true (matching Keystone behavior) unless explicitly set to false
          const indexType = relField.isIndexed ?? true
          if (indexType !== false) {
            foreignKeyIndexes.push({
              foreignKeyField,
              indexType,
            })
          }
        } else {
          // This side does NOT have the foreign key (other side of one-to-one)
          // Just add the relation field without foreign key
          let relationLine = `  ${paddedName} ${targetList}?`

          // Apply extendPrismaSchema if defined (no FK line on this side)
          if (relField.db?.extendPrismaSchema) {
            const extended = relField.db.extendPrismaSchema({ relationLine })
            relationLine = extended.relationLine
          }

          lines.push(relationLine)
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

    // Add indexes for foreign key fields
    for (const { foreignKeyField, indexType } of foreignKeyIndexes) {
      if (indexType === 'unique') {
        lines.push(`  @@unique([${foreignKeyField}])`)
      } else if (indexType === true) {
        lines.push(`  @@index([${foreignKeyField}])`)
      }
    }

    lines.push('}')
    lines.push('')
  }

  // Note: For Keystone naming, we use @relation("relationName") on both sides
  // Prisma automatically creates the join table named _relationName
  // No need to generate explicit join table models

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
