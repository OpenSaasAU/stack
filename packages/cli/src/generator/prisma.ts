import type { OpenSaaSConfig, FieldConfig, RelationshipField } from '@opensaas/stack-core'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Map OpenSaaS field types to Prisma field types
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
 * Generate Prisma schema from OpenSaaS config
 */
export function generatePrismaSchema(config: OpenSaaSConfig): string {
  const lines: string[] = []

  const opensaasPath = config.opensaasPath || '.opensaas'

  // Generator and datasource
  lines.push('generator client {')
  lines.push('  provider = "prisma-client-js"')
  lines.push(`  output   = "../${opensaasPath}/prisma-client"`)
  lines.push('}')
  lines.push('')
  lines.push('datasource db {')
  lines.push(`  provider = "${config.db.provider}"`)
  lines.push('  url      = env("DATABASE_URL")')
  lines.push('}')
  lines.push('')

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
      const { list: targetList } = parseRelationshipRef(relField.ref)
      const _modifiers = getFieldModifiers(fieldName, relField)
      const paddedName = fieldName.padEnd(12)

      if (relField.many) {
        // One-to-many relationship
        lines.push(`  ${paddedName} ${targetList}[]`)
      } else {
        // Many-to-one relationship (add foreign key field)
        const foreignKeyField = `${fieldName}Id`
        const fkPaddedName = foreignKeyField.padEnd(12)

        lines.push(`  ${fkPaddedName} String?`)
        lines.push(
          `  ${paddedName} ${targetList}?  @relation(fields: [${foreignKeyField}], references: [id])`,
        )
      }
    }

    // Always add timestamps
    lines.push('  createdAt DateTime @default(now())')
    lines.push('  updatedAt DateTime @updatedAt')

    lines.push('}')
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Write Prisma schema to file
 */
export function writePrismaSchema(config: OpenSaaSConfig, outputPath: string): void {
  const schema = generatePrismaSchema(config)

  // Ensure directory exists
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(outputPath, schema, 'utf-8')
}
