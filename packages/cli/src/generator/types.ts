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
 * Generate TypeScript Output type for a model (includes virtual fields)
 */
function generateModelOutputType(listName: string, fields: Record<string, FieldConfig>): string {
  const lines: string[] = []

  lines.push(`export type ${listName}Output = {`)
  lines.push('  id: string')

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (fieldConfig.type === 'relationship') {
      const relField = fieldConfig as RelationshipField
      const [targetList] = relField.ref.split('.')

      if (relField.many) {
        lines.push(`  ${fieldName}: ${targetList}Output[]`)
      } else {
        lines.push(`  ${fieldName}Id: string | null`)
        lines.push(`  ${fieldName}: ${targetList}Output | null`)
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
 * Generate convenience type alias (List = ListOutput)
 */
function generateModelTypeAlias(listName: string): string {
  return `export type ${listName} = ${listName}Output`
}

/**
 * Generate CreateInput type
 */
function generateCreateInputType(listName: string, fields: Record<string, FieldConfig>): string {
  const lines: string[] = []

  lines.push(`export type ${listName}CreateInput = {`)

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    // Skip virtual fields - they don't accept input in create operations
    // Virtual fields with resolveInput hooks handle side effects but don't store data
    if (fieldConfig.virtual) {
      continue
    }

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
    // Virtual fields with resolveInput hooks can accept input for side effects
    // but we still skip them in the input type since they don't store data
    if (fieldConfig.virtual) {
      continue
    }

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
 * Generate hook types that reference Prisma input types
 */
function generateHookTypes(listName: string): string {
  const lines: string[] = []

  lines.push(`/**`)
  lines.push(` * Hook types for ${listName} list`)
  lines.push(` * Properly typed to use Prisma's generated input types`)
  lines.push(` */`)
  lines.push(`export type ${listName}Hooks = {`)
  lines.push(`  resolveInput?: (args:`)
  lines.push(`    | {`)
  lines.push(`        operation: 'create'`)
  lines.push(`        resolvedData: Prisma.${listName}CreateInput`)
  lines.push(`        item: undefined`)
  lines.push(`        context: import('@opensaas/stack-core').AccessContext`)
  lines.push(`      }`)
  lines.push(`    | {`)
  lines.push(`        operation: 'update'`)
  lines.push(`        resolvedData: Prisma.${listName}UpdateInput`)
  lines.push(`        item: ${listName}`)
  lines.push(`        context: import('@opensaas/stack-core').AccessContext`)
  lines.push(`      }`)
  lines.push(`  ) => Promise<Prisma.${listName}CreateInput | Prisma.${listName}UpdateInput>`)
  lines.push(`  validateInput?: (args: {`)
  lines.push(`    operation: 'create' | 'update'`)
  lines.push(`    resolvedData: Prisma.${listName}CreateInput | Prisma.${listName}UpdateInput`)
  lines.push(`    item?: ${listName}`)
  lines.push(`    context: import('@opensaas/stack-core').AccessContext`)
  lines.push(`    addValidationError: (msg: string) => void`)
  lines.push(`  }) => Promise<void>`)
  lines.push(`  beforeOperation?: (args: {`)
  lines.push(`    operation: 'create' | 'update' | 'delete'`)
  lines.push(`    resolvedData?: Prisma.${listName}CreateInput | Prisma.${listName}UpdateInput`)
  lines.push(`    item?: ${listName}`)
  lines.push(`    context: import('@opensaas/stack-core').AccessContext`)
  lines.push(`  }) => Promise<void>`)
  lines.push(`  afterOperation?: (args: {`)
  lines.push(`    operation: 'create' | 'update' | 'delete'`)
  lines.push(`    resolvedData?: Prisma.${listName}CreateInput | Prisma.${listName}UpdateInput`)
  lines.push(`    item?: ${listName}`)
  lines.push(`    context: import('@opensaas/stack-core').AccessContext`)
  lines.push(`  }) => Promise<void>`)
  lines.push(`}`)

  return lines.join('\n')
}

/**
 * Generate custom DB interface that overrides AccessControlledDB return types
 * Uses Omit to properly override model delegates with Output types
 */
function generateCustomDBType(config: OpenSaasConfig): string {
  const lines: string[] = []

  // Generate list of db keys to omit from AccessControlledDB
  const dbKeys = Object.keys(config.lists).map((listName) => {
    const dbKey = listName.charAt(0).toLowerCase() + listName.slice(1)
    return `'${dbKey}'`
  })

  lines.push('/**')
  lines.push(
    ' * Custom DB type that overrides AccessControlledDB return types to include virtual fields',
  )
  lines.push(' * Uses Output types which include computed virtual fields')
  lines.push(' */')
  lines.push('export type CustomDB = Omit<AccessControlledDB<PrismaClient>, ')
  lines.push(`  ${dbKeys.join(' | ')}`)
  lines.push('> & {')

  // For each list, create a type that matches AccessControlledDB but uses Output types
  for (const listName of Object.keys(config.lists)) {
    const dbKey = listName.charAt(0).toLowerCase() + listName.slice(1) // camelCase

    lines.push(`  ${dbKey}: {`)
    lines.push(`    // Only the 6 methods implemented by AccessControlledDB`)
    lines.push(
      `    findUnique: (args: { where: { id: string }, include?: any, select?: any }) => Promise<${listName}Output | null>`,
    )
    lines.push(
      `    findMany: (args?: { where?: any, take?: number, skip?: number, include?: any, select?: any, orderBy?: any, distinct?: any, cursor?: any }) => Promise<${listName}Output[]>`,
    )
    lines.push(`    create: (args: { data: any, select?: any, include?: any }) => Promise<${listName}Output>`)
    lines.push(
      `    update: (args: { where: { id: string }, data: any, select?: any, include?: any }) => Promise<${listName}Output | null>`,
    )
    lines.push(`    delete: (args: { where: { id: string }, select?: any, include?: any }) => Promise<${listName}Output | null>`)
    lines.push(`    count: (args?: { where?: any, select?: any }) => Promise<number>`)
    lines.push(`  }`)
  }

  lines.push('}')

  return lines.join('\n')
}

/**
 * Generate Context type that is compatible with AccessContext
 */
function generateContextType(_config: OpenSaasConfig): string {
  const lines: string[] = []

  lines.push('/**')
  lines.push(
    ' * Context type compatible with AccessContext but with CustomDB for virtual field typing',
  )
  lines.push(
    ' * Extends AccessContext and overrides db property to include virtual fields in output types',
  )
  lines.push(' */')
  lines.push(
    "export type Context<TSession extends OpensaasSession = OpensaasSession> = Omit<AccessContext<PrismaClient>, 'db' | 'session'> & {",
  )
  lines.push('  db: CustomDB')
  lines.push('  session: TSession')
  lines.push('  serverAction: (props: ServerActionProps) => Promise<unknown>')
  lines.push('  sudo: () => Context<TSession>')
  lines.push('}')

  return lines.join('\n')
}

/**
 * Collect TypeScript imports from field configurations
 */
function collectFieldImports(config: OpenSaasConfig): Array<{
  names: string[]
  from: string
  typeOnly: boolean
}> {
  const importsMap = new Map<string, { names: Set<string>; typeOnly: boolean }>()

  // Iterate through all lists and fields
  for (const listConfig of Object.values(config.lists)) {
    for (const fieldConfig of Object.values(listConfig.fields)) {
      // Check if field provides imports
      if (fieldConfig.getTypeScriptImports) {
        const imports = fieldConfig.getTypeScriptImports()
        for (const imp of imports) {
          const existing = importsMap.get(imp.from)
          if (existing) {
            // Merge names into existing import
            imp.names.forEach((name) => existing.names.add(name))
            // If either import is not type-only, make the merged import not type-only
            if (imp.typeOnly === false) {
              existing.typeOnly = false
            }
          } else {
            // Add new import
            importsMap.set(imp.from, {
              names: new Set(imp.names),
              typeOnly: imp.typeOnly ?? true,
            })
          }
        }
      }
    }
  }

  // Convert map to array
  return Array.from(importsMap.entries()).map(([from, { names, typeOnly }]) => ({
    names: Array.from(names).sort(),
    from,
    typeOnly,
  }))
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
    "import type { Session as OpensaasSession, StorageUtils, ServerActionProps, AccessControlledDB, AccessContext } from '@opensaas/stack-core'",
  )
  lines.push("import type { PrismaClient, Prisma } from './prisma-client/client'")
  lines.push("import type { PluginServices } from './plugin-types'")

  // Add field-specific imports
  const fieldImports = collectFieldImports(config)
  for (const imp of fieldImports) {
    const typePrefix = imp.typeOnly ? 'type ' : ''
    const names = imp.names.join(', ')
    lines.push(`import ${typePrefix}{ ${names} } from '${imp.from}'`)
  }

  lines.push('')

  // Generate types for each list
  for (const [listName, listConfig] of Object.entries(config.lists)) {
    lines.push(generateModelOutputType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateModelTypeAlias(listName))
    lines.push('')
    lines.push(generateCreateInputType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateUpdateInputType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateWhereInputType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateHookTypes(listName))
    lines.push('')
  }

  // Generate CustomDB interface
  lines.push(generateCustomDBType(config))
  lines.push('')

  // Generate Context type
  lines.push(generateContextType(config))

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
