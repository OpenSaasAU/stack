import type { OpenSaasConfig, ListConfig, DatabaseConfig, FieldConfig } from '@opensaas/stack-core'
import type { TypeInfo } from '@opensaas/stack-core/extend'
import type { RelationshipField, PrismaRelationResult } from '@opensaas/stack-core/fields'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Decide which auto-timestamp columns the generator should inject into a list's model.
 *
 * Auto-timestamps are OFF by default (matching Keystone 6, which never adds them
 * automatically — see ADR-0004). They are enabled globally via `db: { timestamps: true }`
 * and can be overridden per-list via the list's `db.timestamps` option (which takes
 * precedence over the global setting).
 *
 * When timestamps resolve to enabled, the auto column is skipped for any timestamp field
 * the list already declares itself (`createdAt`/`updatedAt`), so Prisma never sees a
 * duplicate field (`P1012`).
 *
 * @returns flags indicating whether to emit each auto column.
 */
export function resolveListTimestamps(
  // ListConfig is generic over per-list TypeInfo; the generator only reads `db`/`fields`,
  // which are invariant across that generic, so the default `TypeInfo` is sufficient.
  listConfig: ListConfig<TypeInfo>,
  dbConfig: DatabaseConfig,
): { createdAt: boolean; updatedAt: boolean } {
  // Per-list override wins over the global setting; otherwise fall back to the global
  // default (off when unset).
  const enabled = listConfig.db?.timestamps ?? dbConfig.timestamps ?? false

  if (!enabled) {
    return { createdAt: false, updatedAt: false }
  }

  // Skip the auto column for any timestamp the list already declares to avoid a
  // duplicate-field error (Prisma P1012).
  const declaresCreatedAt = Object.prototype.hasOwnProperty.call(listConfig.fields, 'createdAt')
  const declaresUpdatedAt = Object.prototype.hasOwnProperty.call(listConfig.fields, 'updatedAt')

  return {
    createdAt: !declaresCreatedAt,
    updatedAt: !declaresUpdatedAt,
  }
}

/**
 * Map OpenSaas field types to Prisma field types
 */
function mapFieldTypeToPrisma(
  fieldName: string,
  field: FieldConfig,
  provider?: string,
  listName?: string,
  keystoneCompat?: boolean,
): string | null {
  // Use field's own Prisma type generator if available
  if (field.getPrismaType) {
    const result = field.getPrismaType(fieldName, provider, listName, keystoneCompat)
    return result.type
  }

  // Fallback for fields without generator methods
  throw new Error(`Field type "${field.type}" does not implement getPrismaType method`)
}

/**
 * Get field modifiers (?, @default, @unique, etc.)
 */
function getFieldModifiers(
  fieldName: string,
  field: FieldConfig,
  provider?: string,
  listName?: string,
  keystoneCompat?: boolean,
): string {
  // Use field's own Prisma type generator if available
  if (field.getPrismaType) {
    const result = field.getPrismaType(fieldName, provider, listName, keystoneCompat)
    return result.modifiers || ''
  }

  // Fallback for fields without generator methods
  return ''
}

/**
 * Generate Prisma schema from OpenSaas config
 */
export function generatePrismaSchema(config: OpenSaasConfig): string {
  const lines: string[] = []

  const opensaasPath = config.opensaasPath || '.opensaas'
  // Keystone-compat mode: when on, non-null text without an explicit default
  // gets Keystone's implicit empty-string default. Threaded to fields via
  // getPrismaType, the same way provider/listName already reach them.
  const keystoneCompat = config.db.keystoneCompat ?? false

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

  // Collect enum definitions from all fields (first pass)
  const enumDefinitions: Map<string, string[]> = new Map()
  for (const [listName, listConfig] of Object.entries(config.lists)) {
    for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
      if (fieldConfig.type === 'relationship' || fieldConfig.virtual) continue
      if (fieldConfig.getPrismaType) {
        const result = fieldConfig.getPrismaType(
          fieldName,
          config.db.provider,
          listName,
          keystoneCompat,
        )
        if (result.enumValues && result.enumValues.length > 0) {
          enumDefinitions.set(result.type, result.enumValues)
        }
      }
    }
  }

  // Generate enum blocks
  for (const [enumName, values] of enumDefinitions) {
    lines.push(`enum ${enumName} {`)
    for (const value of values) {
      lines.push(`  ${value}`)
    }
    lines.push('}')
    lines.push('')
  }

  // Compute every relationship field's Prisma contribution by delegating to the
  // relationship field builder. The generator stays a neutral coordinator: it
  // never inspects relationship topology itself, it only places the lines the
  // field returns into the right model.
  const relationResults = new Map<string, PrismaRelationResult>()
  // Synthetic back-relation lines keyed by the target model they belong to.
  const backRelationsByTarget = new Map<string, string[]>()

  for (const [listName, listConfig] of Object.entries(config.lists)) {
    for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
      // Skip non-relationship fields and virtual relationships (which contribute
      // no database columns and therefore no Prisma schema lines).
      if (fieldConfig.type !== 'relationship' || fieldConfig.virtual) continue

      const relField = fieldConfig as RelationshipField
      if (!relField.getPrismaRelation) {
        throw new Error(
          `Relationship field "${listName}.${fieldName}" does not implement getPrismaRelation method`,
        )
      }

      const result = relField.getPrismaRelation(fieldName, listConfig.fields, listName, config)
      relationResults.set(`${listName}.${fieldName}`, result)

      if (result.backRelation) {
        const existing = backRelationsByTarget.get(result.backRelation.targetList)
        if (existing) {
          existing.push(result.backRelation.line)
        } else {
          backRelationsByTarget.set(result.backRelation.targetList, [result.backRelation.line])
        }
      }
    }
  }

  // Generate models for each list
  for (const [listName, listConfig] of Object.entries(config.lists)) {
    lines.push(`model ${listName} {`)

    // Add id field - singleton lists use Int @id (always 1) to match Keystone 6 behaviour
    if (listConfig.isSingleton) {
      lines.push('  id        Int      @id @default(1)')
    } else {
      lines.push('  id        String   @id @default(cuid())')
    }

    // Track relationship field names (in declaration order) for later processing
    const relationshipFieldNames: string[] = []

    // Add regular fields
    for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
      // Skip virtual fields - they don't create database columns
      if (fieldConfig.virtual) {
        continue
      }

      if (fieldConfig.type === 'relationship') {
        relationshipFieldNames.push(fieldName)
        continue
      }

      const prismaType = mapFieldTypeToPrisma(
        fieldName,
        fieldConfig,
        config.db.provider,
        listName,
        keystoneCompat,
      )
      if (!prismaType) continue // Skip if no type returned

      const modifiers = getFieldModifiers(
        fieldName,
        fieldConfig,
        config.db.provider,
        listName,
        keystoneCompat,
      )

      // Format with proper spacing: '?' attaches to type directly, other modifiers get a space
      const paddedName = fieldName.padEnd(12)
      const modStr = modifiers.trimStart()
      const nullPart = modStr.startsWith('?') ? '?' : ''
      const attrPart = modStr.startsWith('?') ? modStr.slice(1).trimStart() : modStr
      lines.push(`  ${paddedName} ${prismaType}${nullPart}${attrPart ? ' ' + attrPart : ''}`)
    }

    // Add relationship fields (lines + foreign key indexes) from the precomputed results
    const foreignKeyIndexes: NonNullable<PrismaRelationResult['foreignKeyIndex']>[] = []
    for (const fieldName of relationshipFieldNames) {
      const result = relationResults.get(`${listName}.${fieldName}`)!
      lines.push(...result.modelLines)
      if (result.foreignKeyIndex) {
        foreignKeyIndexes.push(result.foreignKeyIndex)
      }
    }

    // Add synthetic relation fields for list-only refs pointing to this list
    const backRelations = backRelationsByTarget.get(listName)
    if (backRelations) {
      for (const line of backRelations) {
        lines.push(line)
      }
    }

    // Add auto-timestamps when enabled (off by default — see ADR-0004). The auto
    // column is skipped for any timestamp the list declares itself (handled inside
    // resolveListTimestamps) so Prisma never sees a duplicate field (P1012).
    const timestamps = resolveListTimestamps(listConfig, config.db)
    if (timestamps.createdAt) {
      lines.push('  createdAt DateTime @default(now())')
    }
    if (timestamps.updatedAt) {
      lines.push('  updatedAt DateTime @default(now()) @updatedAt')
    }

    // Add indexes for foreign key fields
    for (const index of foreignKeyIndexes) {
      if (index.indexType === 'unique') {
        lines.push(`  @@unique([${index.foreignKeyField}])`)
      } else if (index.indexType === true) {
        lines.push(`  @@index([${index.foreignKeyField}])`)
      }
    }

    // Map the model to a custom table name when configured (e.g. adopting
    // existing tables whose physical name differs from the list key).
    if (listConfig.db?.map) {
      lines.push(`  @@map("${listConfig.db.map}")`)
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
