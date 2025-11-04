import type { OpenSaasConfig, FieldConfig, RelationshipField } from '@opensaas/stack-core'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Map OpenSaas field types to TypeScript types
 */
function mapFieldTypeToTypeScript(field: FieldConfig): string | null {
  // Relationships are handled separately
  if (field.type === 'relationship') {
    return null
  }

  // Use field's own TypeScript type generator if available
  if (field.getTypeScriptType) {
    const result = field.getTypeScriptType()
    return result.type
  }

  // Fallback for fields without generator methods
  throw new Error(`Field type "${field.type}" does not implement getTypeScriptType method`)
}

/**
 * Check if a field is optional in the type
 */
function isFieldOptional(field: FieldConfig): boolean {
  // Relationships are always nullable
  if (field.type === 'relationship') {
    return true
  }

  // Use field's own TypeScript type generator if available
  if (field.getTypeScriptType) {
    const result = field.getTypeScriptType()
    return result.optional
  }

  // Fallback: assume optional
  return true
}

/**
 * Generate TypeScript interface for a model
 */
function generateModelType(listName: string, fields: Record<string, FieldConfig>): string {
  const lines: string[] = []

  lines.push(`export type ${listName} = {`)
  lines.push('  id: string')

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (fieldConfig.type === 'relationship') {
      const relField = fieldConfig as RelationshipField
      const [targetList] = relField.ref.split('.')

      if (relField.many) {
        lines.push(`  ${fieldName}: ${targetList}[]`)
      } else {
        lines.push(`  ${fieldName}Id: string | null`)
        lines.push(`  ${fieldName}: ${targetList} | null`)
      }
    } else {
      const tsType = mapFieldTypeToTypeScript(fieldConfig)
      if (!tsType) continue // Skip if no type returned

      const optional = isFieldOptional(fieldConfig)
      const nullability = optional ? ' | null' : ''
      lines.push(`  ${fieldName}: ${tsType}${nullability}`)
    }
  }

  lines.push('  createdAt: Date')
  lines.push('  updatedAt: Date')
  lines.push('}')

  return lines.join('\n')
}

/**
 * Generate CreateInput type
 */
function generateCreateInputType(listName: string, fields: Record<string, FieldConfig>): string {
  const lines: string[] = []

  lines.push(`export type ${listName}CreateInput = {`)

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (fieldConfig.type === 'relationship') {
      const relField = fieldConfig as RelationshipField

      if (relField.many) {
        lines.push(`  ${fieldName}?: { connect: Array<{ id: string }> }`)
      } else {
        lines.push(`  ${fieldName}?: { connect: { id: string } }`)
      }
    } else {
      const tsType = mapFieldTypeToTypeScript(fieldConfig)
      if (!tsType) continue // Skip if no type returned

      const required = !isFieldOptional(fieldConfig) && !fieldConfig.defaultValue
      const optional = required ? '' : '?'
      lines.push(`  ${fieldName}${optional}: ${tsType}`)
    }
  }

  lines.push('}')

  return lines.join('\n')
}

/**
 * Generate UpdateInput type
 */
function generateUpdateInputType(listName: string, fields: Record<string, FieldConfig>): string {
  const lines: string[] = []

  lines.push(`export type ${listName}UpdateInput = {`)

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (fieldConfig.type === 'relationship') {
      const relField = fieldConfig as RelationshipField

      if (relField.many) {
        lines.push(
          `  ${fieldName}?: { connect: Array<{ id: string }>, disconnect: Array<{ id: string }> }`,
        )
      } else {
        lines.push(`  ${fieldName}?: { connect: { id: string } } | { disconnect: true }`)
      }
    } else {
      const tsType = mapFieldTypeToTypeScript(fieldConfig)
      if (!tsType) continue // Skip if no type returned

      lines.push(`  ${fieldName}?: ${tsType}`)
    }
  }

  lines.push('}')

  return lines.join('\n')
}

/**
 * Generate WhereInput type (simplified)
 */
function generateWhereInputType(listName: string, fields: Record<string, FieldConfig>): string {
  const lines: string[] = []

  lines.push(`export type ${listName}WhereInput = {`)
  lines.push('  id?: string')
  lines.push('  AND?: Array<' + listName + 'WhereInput>')
  lines.push('  OR?: Array<' + listName + 'WhereInput>')
  lines.push('  NOT?: ' + listName + 'WhereInput')

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (fieldConfig.type === 'relationship') {
      continue // Skip for now
    } else {
      const tsType = mapFieldTypeToTypeScript(fieldConfig)
      if (!tsType) continue // Skip if no type returned

      lines.push(`  ${fieldName}?: { equals?: ${tsType}, not?: ${tsType} }`)
    }
  }

  lines.push('}')

  return lines.join('\n')
}

/**
 * Generate Context type with all operations
 */
function generateContextType(): string {
  const lines: string[] = []

  lines.push('export type Context<TSession extends OpensaasSession = OpensaasSession> = {')
  lines.push('  db: AccessControlledDB<PrismaClient>')
  lines.push('  session: TSession')
  lines.push('  prisma: PrismaClient')
  lines.push('  storage: StorageUtils')
  lines.push('  serverAction: (props: ServerActionProps) => Promise<unknown>')
  lines.push('}')

  return lines.join('\n')
}

/**
 * Generate all TypeScript types from config
 */
export function generateTypes(config: OpenSaasConfig): string {
  const lines: string[] = []

  // Add header comment
  lines.push('/**')
  lines.push(' * Generated types from OpenSaas configuration')
  lines.push(' * DO NOT EDIT - This file is automatically generated')
  lines.push(' */')
  lines.push('')

  // Add necessary imports
  // Use alias for Session to avoid conflicts if user has a list named "Session"
  lines.push(
    "import type { Session as OpensaasSession, StorageUtils, ServerActionProps, AccessControlledDB } from '@opensaas/stack-core'",
  )
  lines.push("import type { PrismaClient } from './prisma-client'")
  lines.push('')

  // Generate types for each list
  for (const [listName, listConfig] of Object.entries(config.lists)) {
    lines.push(generateModelType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateCreateInputType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateUpdateInputType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateWhereInputType(listName, listConfig.fields))
    lines.push('')
  }

  // Generate Context type
  lines.push(generateContextType())

  return lines.join('\n')
}

/**
 * Write TypeScript types to file
 */
export function writeTypes(config: OpenSaasConfig, outputPath: string): void {
  const types = generateTypes(config)

  // Ensure directory exists
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(outputPath, types, 'utf-8')
}
