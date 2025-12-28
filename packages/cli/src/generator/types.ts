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
 * Get names of virtual fields in a list
 */
function getVirtualFieldNames(fields: Record<string, FieldConfig>): string[] {
  return Object.entries(fields)
    .filter(([_, config]) => config.type === 'virtual')
    .map(([name, _]) => name)
}

/**
 * Generate virtual fields type - only contains virtual fields
 * This is intersected with Prisma's GetPayload to add virtual fields to query results
 */
function generateVirtualFieldsType(listName: string, fields: Record<string, FieldConfig>): string {
  const lines: string[] = []
  const virtualFields = Object.entries(fields).filter(([_, config]) => config.type === 'virtual')

  lines.push(`/**`)
  lines.push(` * Virtual fields for ${listName} - computed fields not in database`)
  lines.push(` * These are added to query results via resolveOutput hooks`)
  lines.push(` */`)
  lines.push(`export type ${listName}VirtualFields = {`)

  for (const [fieldName, fieldConfig] of virtualFields) {
    const tsType = mapFieldTypeToTypeScript(fieldConfig)
    if (!tsType) continue

    const optional = isFieldOptional(fieldConfig)
    const nullability = optional ? ' | null' : ''
    lines.push(`  ${fieldName}: ${tsType}${nullability}`)
  }

  // If no virtual fields, make it an empty object
  if (virtualFields.length === 0) {
    lines.push('  // No virtual fields defined')
  }

  lines.push('}')

  return lines.join('\n')
}

/**
 * Generate transformed fields type - fields with resultExtension transformations
 * This replaces Prisma's base types with transformed types (e.g., string -> HashedPassword)
 */
function generateTransformedFieldsType(
  listName: string,
  fields: Record<string, FieldConfig>,
): string {
  const lines: string[] = []
  const transformedFields = Object.entries(fields).filter(([_, config]) => config.resultExtension)

  lines.push(`/**`)
  lines.push(` * Transformed fields for ${listName} - fields with resultExtension transformations`)
  lines.push(` * These override Prisma's base types with transformed types via result extensions`)
  lines.push(` */`)
  lines.push(`export type ${listName}TransformedFields = {`)

  for (const [fieldName, fieldConfig] of transformedFields) {
    if (fieldConfig.resultExtension) {
      const optional = isFieldOptional(fieldConfig)
      const nullability = optional ? ' | undefined' : ''
      lines.push(`  ${fieldName}: ${fieldConfig.resultExtension.outputType}${nullability}`)
    }
  }

  // If no transformed fields, make it an empty object
  if (transformedFields.length === 0) {
    lines.push('  // No transformed fields defined')
  }

  lines.push('}')

  return lines.join('\n')
}

/**
 * Generate TypeScript Output type for a model (includes virtual fields)
 * This is kept for backwards compatibility but CustomDB uses Prisma's GetPayload + VirtualFields
 */
function generateModelOutputType(listName: string, fields: Record<string, FieldConfig>): string {
  const lines: string[] = []

  lines.push(`export type ${listName}Output = {`)
  lines.push('  id: string')

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    // Skip virtual fields - they're in VirtualFields type
    if (fieldConfig.type === 'virtual') continue

    if (fieldConfig.type === 'relationship') {
      const relField = fieldConfig as RelationshipField
      const [targetList] = relField.ref.split('.')

      if (relField.many) {
        lines.push(`  ${fieldName}?: ${targetList}Output[]`) // Optional since only present with include
      } else {
        lines.push(`  ${fieldName}Id: string | null`)
        lines.push(`  ${fieldName}?: ${targetList}Output | null`) // Optional since only present with include
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
  lines.push('} & ' + listName + 'VirtualFields') // Include virtual fields

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
 * Extract the related list name from a relationship ref
 * @param ref - Relationship ref in format 'ListName' or 'ListName.fieldName'
 * @returns The list name (first part before '.')
 */
function getRelatedListName(ref: string): string {
  return ref.split('.')[0]
}

/**
 * Map Prisma scalar types to their corresponding filter types
 * @param prismaType - The Prisma scalar type (e.g., 'String', 'Int', 'Boolean')
 * @param listName - The list name for the filter type generic
 * @returns The Prisma filter type with primitive fallback (e.g., 'Prisma.StringFilter<"Post"> | string')
 */
function getPrismaFilterType(prismaType: string, listName: string): string {
  const filterMap: Record<string, { filter: string; primitive: string }> = {
    String: { filter: 'StringFilter', primitive: 'string' },
    Int: { filter: 'IntFilter', primitive: 'number' },
    Decimal: { filter: 'DecimalFilter', primitive: 'Prisma.Decimal | number | string' },
    Boolean: { filter: 'BoolFilter', primitive: 'boolean' },
    DateTime: { filter: 'DateTimeFilter', primitive: 'Date' },
    Json: { filter: 'JsonFilter', primitive: 'Prisma.InputJsonValue' },
  }

  const mapping = filterMap[prismaType]
  if (!mapping) {
    // Fallback for unknown types - shouldn't happen but provides safety
    return `{ equals?: ${prismaType.toLowerCase()}, not?: ${prismaType.toLowerCase()} }`
  }

  return `Prisma.${mapping.filter}<"${listName}"> | ${mapping.primitive}`
}

/**
 * Generate WhereInput type with relationship field support
 * Uses Prisma's built-in filter types for all scalar fields
 */
function generateWhereInputType(listName: string, fields: Record<string, FieldConfig>): string {
  const lines: string[] = []

  lines.push(`export type ${listName}WhereInput = {`)
  // Use Prisma's StringFilter for id field
  lines.push(`  id?: Prisma.StringFilter<"${listName}"> | string`)
  // Fix AND/OR/NOT to match Prisma's structure (support both single object and array)
  lines.push(`  AND?: ${listName}WhereInput | ${listName}WhereInput[]`)
  lines.push(`  OR?: ${listName}WhereInput[]`)
  lines.push(`  NOT?: ${listName}WhereInput | ${listName}WhereInput[]`)

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    // Skip virtual fields - they don't exist in database
    if (fieldConfig.virtual) continue

    if (fieldConfig.type === 'relationship') {
      const relField = fieldConfig as RelationshipField
      const relatedListName = getRelatedListName(relField.ref)
      const relatedWhereInput = `${relatedListName}WhereInput`

      if (relField.many) {
        // One-to-many or many-to-many relationship
        lines.push(`  ${fieldName}?: {`)
        lines.push(`    some?: ${relatedWhereInput}`)
        lines.push(`    every?: ${relatedWhereInput}`)
        lines.push(`    none?: ${relatedWhereInput}`)
        lines.push(`  }`)
      } else {
        // One-to-one or many-to-one relationship
        lines.push(`  ${fieldName}?: ${relatedWhereInput} | null`)
      }
    } else {
      // Use field's Prisma type to get the correct filter type
      if (fieldConfig.getPrismaType) {
        const { type: prismaType } = fieldConfig.getPrismaType(fieldName)
        const filterType = getPrismaFilterType(prismaType, listName)
        lines.push(`  ${fieldName}?: ${filterType}`)
      } else {
        // Fallback for fields without getPrismaType (shouldn't happen)
        const tsType = mapFieldTypeToTypeScript(fieldConfig)
        if (tsType) {
          lines.push(`  ${fieldName}?: { equals?: ${tsType}, not?: ${tsType} }`)
        }
      }
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
 * Generate Select type that includes virtual fields
 * Extends Prisma's Select type with virtual field selection support and nested relationship overrides
 */
function generateSelectType(listName: string, fields: Record<string, FieldConfig>): string {
  const virtualFields = getVirtualFieldNames(fields)
  const relationshipFields = Object.entries(fields)
    .filter(([_, config]) => config.type === 'relationship')
    .map(([name, config]) => ({
      name,
      targetList: (config as RelationshipField).ref.split('.')[0],
    }))

  if (virtualFields.length === 0 && relationshipFields.length === 0) {
    // No virtual fields and no relationships - just re-export Prisma type
    return `/**
 * Select type for ${listName}
 * No virtual fields defined, uses Prisma's Select type directly
 */
export type ${listName}Select = Prisma.${listName}Select`
  }

  const lines: string[] = []

  // Add virtual field properties
  if (virtualFields.length > 0) {
    virtualFields.forEach((name) => {
      lines.push(`  ${name}?: boolean`)
    })
  }

  // Override relationship properties to use custom DefaultArgs
  if (relationshipFields.length > 0) {
    relationshipFields.forEach(({ name, targetList }) => {
      lines.push(`  ${name}?: boolean | ${targetList}DefaultArgs`)
    })
  }

  if (lines.length === 0) {
    return `/**
 * Select type for ${listName}
 * Uses Prisma's Select type directly
 */
export type ${listName}Select = Prisma.${listName}Select`
  }

  const exampleLines: string[] = []
  if (virtualFields.length > 0) {
    exampleLines.push(...virtualFields.map((name) => ` *   ${name}: true, // Virtual field`))
  }

  return `/**
 * Select type for ${listName} with virtual field support
 * Extends Prisma's Select type to include virtual fields
 * and supports custom Select types in nested relationships
 * Use this type when selecting fields to enable virtual field selection
 *
 * @example
 * const select = {
 *   id: true,
 *   name: true,
${exampleLines.join('\n')}
 * } satisfies ${listName}Select
 */
export type ${listName}Select = Prisma.${listName}Select & {
${lines.join('\n')}
}`
}

/**
 * Generate Include type that includes virtual fields
 * Extends Prisma's Include type with virtual field inclusion support and nested relationship overrides
 * Note: Only generates Include type if the list has relationship fields,
 * since Prisma only generates Include types for models with relations
 */
function generateIncludeType(listName: string, fields: Record<string, FieldConfig>): string | null {
  // Check if list has any relationship fields
  const relationshipFields = Object.entries(fields)
    .filter(([_, config]) => config.type === 'relationship')
    .map(([name, config]) => ({
      name,
      targetList: (config as RelationshipField).ref.split('.')[0],
    }))

  // Prisma only generates Include types for models with relationships
  // If there are no relationships, don't generate an Include type
  if (relationshipFields.length === 0) {
    return null
  }

  const virtualFields = getVirtualFieldNames(fields)

  const lines: string[] = []

  // Add virtual field properties
  if (virtualFields.length > 0) {
    virtualFields.forEach((name) => {
      lines.push(`  ${name}?: boolean`)
    })
  }

  // Override relationship properties to use custom DefaultArgs
  relationshipFields.forEach(({ name, targetList }) => {
    lines.push(`  ${name}?: boolean | ${targetList}DefaultArgs`)
  })

  if (lines.length === 0) {
    // No virtual fields - just re-export Prisma type
    return `/**
 * Include type for ${listName}
 * No virtual fields defined, uses Prisma's Include type directly
 */
export type ${listName}Include = Prisma.${listName}Include`
  }

  const exampleLines: string[] = []
  if (virtualFields.length > 0) {
    exampleLines.push(...virtualFields.map((name) => ` *   ${name}: true, // Virtual field`))
  }

  return `/**
 * Include type for ${listName} with virtual field support
 * Extends Prisma's Include type to include virtual fields
 * and supports custom Include types in nested relationships
 * Use this type when including relationships to enable virtual field selection
 *
 * @example
 * const include = {
 *   author: true,
${exampleLines.join('\n')}
 * } satisfies ${listName}Include
 */
export type ${listName}Include = Prisma.${listName}Include & {
${lines.join('\n')}
}`
}

/**
 * Generate GetPayload helper type that adds virtual fields support to Prisma's GetPayload
 * This allows users to use Prisma.{ListName}GetPayload<T> pattern with virtual fields
 * Always generated to ensure consistency in CustomDB type signatures
 * Even lists without virtual fields need this to support nested relations with virtual fields
 */
function generateGetPayloadType(listName: string, fields: Record<string, FieldConfig>): string {
  const virtualFields = getVirtualFieldNames(fields)
  const transformedFieldNames = Object.entries(fields)
    .filter(([_, config]) => config.resultExtension)
    .map(([name, _]) => name)

  // Get relationship fields to override with custom GetPayload types
  const relationshipFields = Object.entries(fields)
    .filter(([_, config]) => config.type === 'relationship')
    .map(([name, config]) => ({
      name,
      targetList: (config as RelationshipField).ref.split('.')[0],
      many: !!(config as RelationshipField).many,
    }))

  const lines: string[] = []

  // Build documentation
  lines.push(`/**`)
  if (virtualFields.length > 0 || transformedFieldNames.length > 0) {
    lines.push(` * GetPayload type for ${listName} with virtual and transformed field support`)
    lines.push(` * Extends Prisma's GetPayload to include virtual and transformed fields`)
  } else {
    lines.push(` * GetPayload type for ${listName}`)
    lines.push(` * Wraps Prisma's GetPayload to ensure nested relations support virtual fields`)
  }
  lines.push(` * Use this type to get properly typed results with virtual fields`)
  lines.push(` *`)
  lines.push(` * @example`)
  lines.push(` * const select = {`)
  lines.push(` *   id: true,`)
  if (virtualFields.length > 0) {
    virtualFields.forEach((fieldName) => {
      lines.push(` *   ${fieldName}: true, // Virtual field`)
    })
  } else {
    lines.push(` *   // Relations can include virtual fields from related lists`)
  }
  lines.push(` * } satisfies ${listName}Select`)
  lines.push(` *`)
  lines.push(` * type Result = ${listName}GetPayload<{ select: typeof select }>`)
  lines.push(` */`)

  lines.push(`export type ${listName}GetPayload<T extends { select?: any; include?: any } = {}> =`)

  // Build the base type (Prisma's GetPayload minus relationship and transformed fields)
  const fieldsToOmit = [...transformedFieldNames, ...relationshipFields.map((r) => r.name)]
  if (fieldsToOmit.length > 0) {
    lines.push(
      `  Omit<Prisma.${listName}GetPayload<T>, ${fieldsToOmit.map((n) => `'${n}'`).join(' | ')}> &`,
    )
  } else {
    lines.push(`  Prisma.${listName}GetPayload<T> &`)
  }

  // Add transformed fields back
  if (transformedFieldNames.length > 0) {
    lines.push(`  ${listName}TransformedFields &`)
  }

  // Add relationship fields back with custom GetPayload types
  if (relationshipFields.length > 0) {
    lines.push(`  {`)
    for (const rel of relationshipFields) {
      lines.push(`    ${rel.name}?:`)
      lines.push(`      T extends { select: any }`)
      lines.push(`        ? '${rel.name}' extends keyof T['select']`)
      lines.push(`          ? T['select']['${rel.name}'] extends true`)
      lines.push(`            ? ${rel.targetList}${rel.many ? '[]' : ''}`)
      lines.push(`            : T['select']['${rel.name}'] extends { select: any }`)
      lines.push(
        `              ? ${rel.targetList}GetPayload<{ select: T['select']['${rel.name}']['select'] }>${rel.many ? '[]' : ''}`,
      )
      lines.push(`              : T['select']['${rel.name}'] extends { include: any }`)
      lines.push(
        `                ? ${rel.targetList}GetPayload<{ include: T['select']['${rel.name}']['include'] }>${rel.many ? '[]' : ''}`,
      )
      lines.push(`                : ${rel.targetList}${rel.many ? '[]' : ''}`)
      lines.push(`          : never`)
      lines.push(`        : T extends { include: any }`)
      lines.push(`          ? T['include'] extends true`)
      lines.push(`            ? ${rel.targetList}${rel.many ? '[]' : ''}`)
      lines.push(`            : '${rel.name}' extends keyof T['include']`)
      lines.push(`              ? T['include']['${rel.name}'] extends true`)
      lines.push(`                ? ${rel.targetList}${rel.many ? '[]' : ''}`)
      lines.push(`                : T['include']['${rel.name}'] extends { select: any }`)
      lines.push(
        `                  ? ${rel.targetList}GetPayload<{ select: T['include']['${rel.name}']['select'] }>${rel.many ? '[]' : ''}`,
      )
      lines.push(`                  : T['include']['${rel.name}'] extends { include: any }`)
      lines.push(
        `                    ? ${rel.targetList}GetPayload<{ include: T['include']['${rel.name}']['include'] }>${rel.many ? '[]' : ''}`,
      )
      lines.push(`                    : ${rel.targetList}${rel.many ? '[]' : ''}`)
      lines.push(`              : never`)
      lines.push(`          : ${rel.targetList}${rel.many ? '[]' : ''}`)
    }
    lines.push(`  } &`)
  }

  // Build the virtual fields conditional type
  if (virtualFields.length > 0) {
    lines.push(`  (`)
    lines.push(`    T extends { select: any }`)
    lines.push(`      ? T['select'] extends true`)
    lines.push(`        ? ${listName}VirtualFields`)
    lines.push(`        : {`)
    lines.push(`            [K in keyof ${listName}VirtualFields as K extends keyof T['select']`)
    lines.push(`              ? T['select'][K] extends true`)
    lines.push(`                ? K`)
    lines.push(`                : never`)
    lines.push(`              : never]: ${listName}VirtualFields[K]`)
    lines.push(`          }`)
    lines.push(`      : T extends { include: any }`)
    lines.push(`        ? T['include'] extends true`)
    lines.push(`          ? ${listName}VirtualFields`)
    lines.push(`          : {`)
    lines.push(`              [K in keyof ${listName}VirtualFields as K extends keyof T['include']`)
    lines.push(`                ? T['include'][K] extends true`)
    lines.push(`                  ? K`)
    lines.push(`                  : never`)
    lines.push(`                : never]: ${listName}VirtualFields[K]`)
    lines.push(`            }`)
    lines.push(`        : ${listName}VirtualFields`)
    lines.push(`  )`)
  } else {
    // No virtual fields, just use empty object
    lines.push(`  {}`)
  }

  return lines.join('\n')
}

/**
 * Generate DefaultArgs type for nested relationship selections
 * This type is used when selecting relationships to enable custom Select/Include types
 */
function generateDefaultArgsType(listName: string, fields: Record<string, FieldConfig>): string {
  const hasRelationships = Object.values(fields).some((field) => field.type === 'relationship')

  if (hasRelationships) {
    return `/**
 * Default args type for ${listName} with custom Select/Include support
 * Used in nested relationship selections to support virtual fields
 */
export type ${listName}DefaultArgs = {
  select?: ${listName}Select | null
  include?: ${listName}Include | null
}`
  } else {
    return `/**
 * Default args type for ${listName} with custom Select support
 * Used in nested relationship selections to support virtual fields
 */
export type ${listName}DefaultArgs = {
  select?: ${listName}Select | null
}`
  }
}

/**
 * Generate custom FindUniqueArgs type that uses our extended Select/Include
 */
function generateFindUniqueArgsType(listName: string, fields: Record<string, FieldConfig>): string {
  const hasRelationships = Object.values(fields).some((field) => field.type === 'relationship')

  if (hasRelationships) {
    return `/**
 * Custom FindUniqueArgs for ${listName} with virtual field support in nested relationships
 */
export type ${listName}FindUniqueArgs = Omit<Prisma.${listName}FindUniqueArgs, 'select' | 'include'> & {
  select?: ${listName}Select | null
  include?: ${listName}Include | null
}`
  } else {
    return `/**
 * Custom FindUniqueArgs for ${listName} with virtual field support
 */
export type ${listName}FindUniqueArgs = Omit<Prisma.${listName}FindUniqueArgs, 'select'> & {
  select?: ${listName}Select | null
}`
  }
}

/**
 * Generate custom FindManyArgs type that uses our extended Select/Include
 */
function generateFindManyArgsType(listName: string, fields: Record<string, FieldConfig>): string {
  const hasRelationships = Object.values(fields).some((field) => field.type === 'relationship')

  if (hasRelationships) {
    return `/**
 * Custom FindManyArgs for ${listName} with virtual field support in nested relationships
 */
export type ${listName}FindManyArgs = Omit<Prisma.${listName}FindManyArgs, 'select' | 'include'> & {
  select?: ${listName}Select | null
  include?: ${listName}Include | null
}`
  } else {
    return `/**
 * Custom FindManyArgs for ${listName} with virtual field support
 */
export type ${listName}FindManyArgs = Omit<Prisma.${listName}FindManyArgs, 'select'> & {
  select?: ${listName}Select | null
}`
  }
}

/**
 * Generate custom CreateArgs type that uses our extended Select/Include
 */
function generateCreateArgsType(listName: string, fields: Record<string, FieldConfig>): string {
  const hasRelationships = Object.values(fields).some((field) => field.type === 'relationship')

  if (hasRelationships) {
    return `/**
 * Custom CreateArgs for ${listName} with virtual field support in nested relationships
 */
export type ${listName}CreateArgs = Omit<Prisma.${listName}CreateArgs, 'select' | 'include'> & {
  select?: ${listName}Select | null
  include?: ${listName}Include | null
}`
  } else {
    return `/**
 * Custom CreateArgs for ${listName} with virtual field support
 */
export type ${listName}CreateArgs = Omit<Prisma.${listName}CreateArgs, 'select'> & {
  select?: ${listName}Select | null
}`
  }
}

/**
 * Generate custom UpdateArgs type that uses our extended Select/Include
 */
function generateUpdateArgsType(listName: string, fields: Record<string, FieldConfig>): string {
  const hasRelationships = Object.values(fields).some((field) => field.type === 'relationship')

  if (hasRelationships) {
    return `/**
 * Custom UpdateArgs for ${listName} with virtual field support in nested relationships
 */
export type ${listName}UpdateArgs = Omit<Prisma.${listName}UpdateArgs, 'select' | 'include'> & {
  select?: ${listName}Select | null
  include?: ${listName}Include | null
}`
  } else {
    return `/**
 * Custom UpdateArgs for ${listName} with virtual field support
 */
export type ${listName}UpdateArgs = Omit<Prisma.${listName}UpdateArgs, 'select'> & {
  select?: ${listName}Select | null
}`
  }
}

/**
 * Generate custom DeleteArgs type that uses our extended Select/Include
 */
function generateDeleteArgsType(listName: string, fields: Record<string, FieldConfig>): string {
  const hasRelationships = Object.values(fields).some((field) => field.type === 'relationship')

  if (hasRelationships) {
    return `/**
 * Custom DeleteArgs for ${listName} with virtual field support in nested relationships
 */
export type ${listName}DeleteArgs = Omit<Prisma.${listName}DeleteArgs, 'select' | 'include'> & {
  select?: ${listName}Select | null
  include?: ${listName}Include | null
}`
  } else {
    return `/**
 * Custom DeleteArgs for ${listName} with virtual field support
 */
export type ${listName}DeleteArgs = Omit<Prisma.${listName}DeleteArgs, 'select'> & {
  select?: ${listName}Select | null
}`
  }
}

/**
 * Generate custom DB interface that uses Prisma's conditional types with virtual and transformed fields
 * This leverages Prisma's GetPayload utility to get correct types based on select/include
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
    " * Custom DB type that uses Prisma's conditional types with virtual and transformed field support",
  )
  lines.push(
    ' * Types change based on select/include - relationships only present when explicitly included',
  )
  lines.push(' * Virtual fields and transformed fields are added to the base model type')
  lines.push(' */')
  lines.push('export type CustomDB = Omit<AccessControlledDB<PrismaClient>, ')
  lines.push(`  ${dbKeys.join(' | ')}`)
  lines.push('> & {')

  // For each list, create strongly-typed methods using Prisma's conditional types
  for (const listName of Object.keys(config.lists)) {
    const dbKey = listName.charAt(0).toLowerCase() + listName.slice(1) // camelCase
    const listConfig = config.lists[listName]
    const isSingleton = !!listConfig?.isSingleton

    lines.push(`  ${dbKey}: {`)

    // findUnique - generic to preserve Prisma's conditional return type with custom Args for virtual field support
    lines.push(`    findUnique: <T extends ${listName}FindUniqueArgs>(`)
    lines.push(`      args: Prisma.SelectSubset<T, ${listName}FindUniqueArgs>`)
    lines.push(`    ) => Promise<${listName}GetPayload<T> | null>`)

    // findMany - generic to preserve Prisma's conditional return type with custom Args for virtual field support
    lines.push(`    findMany: <T extends ${listName}FindManyArgs>(`)
    lines.push(`      args?: Prisma.SelectSubset<T, ${listName}FindManyArgs>`)
    lines.push(`    ) => Promise<Array<${listName}GetPayload<T>>>`)

    // create - generic to preserve Prisma's conditional return type with custom Args for virtual field support
    lines.push(`    create: <T extends ${listName}CreateArgs>(`)
    lines.push(`      args: Prisma.SelectSubset<T, ${listName}CreateArgs>`)
    lines.push(`    ) => Promise<${listName}GetPayload<T>>`)

    // update - generic to preserve Prisma's conditional return type with custom Args for virtual field support
    lines.push(`    update: <T extends ${listName}UpdateArgs>(`)
    lines.push(`      args: Prisma.SelectSubset<T, ${listName}UpdateArgs>`)
    lines.push(`    ) => Promise<${listName}GetPayload<T> | null>`)

    // delete - generic to preserve Prisma's conditional return type with custom Args for virtual field support
    lines.push(`    delete: <T extends ${listName}DeleteArgs>(`)
    lines.push(`      args: Prisma.SelectSubset<T, ${listName}DeleteArgs>`)
    lines.push(`    ) => Promise<${listName}GetPayload<T> | null>`)

    // count - no changes to return type
    lines.push(`    count: (args?: Prisma.${listName}CountArgs) => Promise<number>`)

    // get - only for singleton lists
    if (isSingleton) {
      lines.push(`    get: () => Promise<${listName}GetPayload<{}> | null>`)
    }

    lines.push(`  }`)
  }

  lines.push('}')

  return lines.join('\n')
}

/**
 * Generate BaseContext and Context types that are compatible with AccessContext
 */
function generateContextType(_config: OpenSaasConfig): string {
  const lines: string[] = []

  // Generate BaseContext - minimal interface for services that only need db and session
  lines.push('/**')
  lines.push(' * Base context type for services that only need database and session access')
  lines.push(' * Compatible with both AccessContext (from hooks) and Context (from server actions)')
  lines.push(' * Use this type for services that should work in both contexts')
  lines.push(' */')
  lines.push(
    "export type BaseContext<TSession extends OpensaasSession = OpensaasSession> = Omit<AccessContext<PrismaClient>, 'db' | 'session'> & {",
  )
  lines.push('  db: CustomDB')
  lines.push('  session: TSession')
  lines.push('}')
  lines.push('')

  // Generate Context - extends BaseContext and adds server action capabilities
  lines.push('/**')
  lines.push(' * Full context type with server action capabilities and virtual field typing')
  lines.push(' * Extends BaseContext and adds serverAction and sudo methods')
  lines.push(
    ' * Use this type in server actions and components that need full context capabilities',
  )
  lines.push(' */')
  lines.push(
    'export type Context<TSession extends OpensaasSession = OpensaasSession> = BaseContext<TSession> & {',
  )
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
    // Generate VirtualFields type first (needed by Output type and CustomDB)
    lines.push(generateVirtualFieldsType(listName, listConfig.fields))
    lines.push('')
    // Generate TransformedFields type (needed by CustomDB)
    lines.push(generateTransformedFieldsType(listName, listConfig.fields))
    lines.push('')
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
    // Generate Select and Include types with virtual field support
    lines.push(generateSelectType(listName, listConfig.fields))
    lines.push('')
    // Only generate Include type if the list has relationships
    const includeType = generateIncludeType(listName, listConfig.fields)
    if (includeType) {
      lines.push(includeType)
      lines.push('')
    }
    // Generate GetPayload helper type with virtual field support
    lines.push(generateGetPayloadType(listName, listConfig.fields))
    lines.push('')
    // Generate DefaultArgs type for nested relationship support
    lines.push(generateDefaultArgsType(listName, listConfig.fields))
    lines.push('')
    // Generate custom Args types with virtual field support
    lines.push(generateFindUniqueArgsType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateFindManyArgsType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateCreateArgsType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateUpdateArgsType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateDeleteArgsType(listName, listConfig.fields))
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
