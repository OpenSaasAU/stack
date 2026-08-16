import type {
  OpenSaasConfig,
  ListConfig,
  DatabaseConfig,
  FieldConfig,
  ListIndex,
} from '@opensaas/stack-core'
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
 * Get the block-level index a field asks for, if any.
 *
 * Prisma has no field-level `@index` attribute, so a non-unique index cannot
 * ride along in the field's modifiers — the field requests it out-of-line and
 * the generator emits `@@index([...])` on the model, exactly as it already does
 * for relationship foreign keys via `getPrismaRelation`.
 */
function getFieldIndex(
  fieldName: string,
  field: FieldConfig,
  provider?: string,
  listName?: string,
  keystoneCompat?: boolean,
): boolean | 'unique' | undefined {
  if (field.getPrismaType) {
    return field.getPrismaType(fieldName, provider, listName, keystoneCompat).index
  }

  return undefined
}

/**
 * Resolve one field reference inside a model-level {@link ListIndex} (#864) to
 * the Prisma column it must emit — the OpenSaaS field name for a scalar (the
 * Prisma-level field name is unaffected by `db.map`), or the owning foreign
 * key column (`<field>Id`) for a relationship field.
 *
 * Throws a descriptive, generate-time error (naming the list, the index
 * entry, and the bad field) rather than silently dropping the entry or
 * emitting invalid Prisma, for every case that has no single column to
 * reference: an unknown field, a virtual field, a multi-column field, a
 * to-many relationship, or the non-FK side of a one-to-one relationship.
 */
function resolveIndexFieldColumn(
  listName: string,
  listConfig: ListConfig<TypeInfo>,
  relationResults: Map<string, PrismaRelationResult>,
  entryDescription: string,
  fieldRef: ListIndex['fields'][number],
): { column: string; sort?: 'asc' | 'desc' } {
  const fieldName = typeof fieldRef === 'string' ? fieldRef : fieldRef.field
  const sort = typeof fieldRef === 'string' ? undefined : fieldRef.sort

  const fieldConfig = listConfig.fields[fieldName]
  if (!fieldConfig) {
    throw new Error(
      `${entryDescription} on list "${listName}" references unknown field "${fieldName}"`,
    )
  }

  if (fieldConfig.virtual) {
    throw new Error(
      `${entryDescription} on list "${listName}" references virtual field "${fieldName}", which has no database column`,
    )
  }

  if (fieldConfig.type === 'relationship') {
    const relField = fieldConfig as RelationshipField
    if (relField.many) {
      throw new Error(
        `${entryDescription} on list "${listName}" references to-many relationship field "${fieldName}", which has no single database column`,
      )
    }

    const relResult = relationResults.get(`${listName}.${fieldName}`)
    if (!relResult?.foreignKeyField) {
      throw new Error(
        `${entryDescription} on list "${listName}" references relationship field "${fieldName}", which does not own a foreign key column on this model (the other side of the relationship owns it)`,
      )
    }

    return { column: relResult.foreignKeyField, sort }
  }

  if (fieldConfig.getPrismaColumns) {
    throw new Error(
      `${entryDescription} on list "${listName}" references field "${fieldName}", which maps to more than one database column and cannot be used in a model-level index`,
    )
  }

  return { column: fieldName, sort }
}

/**
 * A field-level `isIndexed` declaration that already produces a single-column
 * `@@unique`/`@@index` line, keyed by the Prisma column it indexes. Used to
 * detect a `db.indexes` single-field entry that would duplicate it (#918).
 */
type FieldLevelIndexColumn = { fieldName: string; indexType: boolean | 'unique' }

/**
 * Collect every field on the list carrying a field-level `isIndexed`
 * declaration, keyed by the Prisma column it indexes — the column a
 * single-field `db.indexes` entry must not also target (#918).
 *
 * Reads `isIndexed` generically (not every field type declares it, so the
 * property is read via a narrow cast) rather than reusing the block-index
 * bookkeeping the main generation loop builds for `@@index`/`@@unique`
 * lines: a scalar field's `isIndexed: 'unique'` emits an inline field-level
 * `@unique`, not a block line, but it still owns the column and still
 * collides with a `db.indexes` entry naming it. A relationship field with no
 * explicit `isIndexed` defaults to indexed (matching the FK auto-index
 * default in the relationship field builder); a to-many relationship has no
 * single foreign-key column and is skipped.
 */
function collectFieldLevelIndexColumns(
  listName: string,
  listConfig: ListConfig<TypeInfo>,
  relationResults: Map<string, PrismaRelationResult>,
): Map<string, FieldLevelIndexColumn> {
  const columns = new Map<string, FieldLevelIndexColumn>()

  for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
    if (fieldConfig.virtual) continue

    if (fieldConfig.type === 'relationship') {
      const relField = fieldConfig as RelationshipField
      if (relField.many) continue
      const indexType = relField.isIndexed ?? true
      if (indexType === false) continue
      const relResult = relationResults.get(`${listName}.${fieldName}`)
      if (relResult?.foreignKeyField) {
        columns.set(relResult.foreignKeyField, { fieldName, indexType })
      }
      continue
    }

    const indexType = (fieldConfig as { isIndexed?: boolean | 'unique' }).isIndexed
    if (indexType === undefined || indexType === false) continue
    columns.set(fieldName, { fieldName, indexType })
  }

  return columns
}

/**
 * Generate the `@@unique([...])`/`@@index([...])` lines for a list's
 * model-level `db.indexes` (#864). Emitted after the existing field-level
 * scalar/foreign-key index lines, in declaration order, so a config with no
 * `db.indexes` produces byte-for-byte identical output to before this
 * feature existed.
 *
 * An entry spans one or more fields (#918) — arity is incidental; a named
 * single-column constraint is as legitimate as a composite one. Two cases
 * fail generation rather than silently producing nothing or invalid Prisma:
 * an empty `fields` array, and a single-field entry that indexes the exact
 * column a field-level `isIndexed` already indexes.
 */
function generateModelIndexLines(
  listName: string,
  listConfig: ListConfig<TypeInfo>,
  relationResults: Map<string, PrismaRelationResult>,
  fieldLevelIndexColumns: Map<string, FieldLevelIndexColumn>,
): string[] {
  const indexes = listConfig.db?.indexes
  if (!indexes || indexes.length === 0) return []

  return indexes.map((index, i) => {
    const entryDescription = `Model-level index db.indexes[${i}]`

    if (index.fields.length === 0) {
      throw new Error(
        `${entryDescription} on list "${listName}" has an empty "fields" array — an index/constraint must name at least one field`,
      )
    }

    const resolved = index.fields.map((fieldRef) =>
      resolveIndexFieldColumn(listName, listConfig, relationResults, entryDescription, fieldRef),
    )

    if (resolved.length === 1) {
      const collision = fieldLevelIndexColumns.get(resolved[0].column)
      if (collision) {
        const isIndexedValue =
          typeof collision.indexType === 'string' ? `'${collision.indexType}'` : 'true'
        throw new Error(
          `${entryDescription} on list "${listName}" duplicates the constraint already produced by field "${collision.fieldName}"'s isIndexed: ${isIndexedValue} — both would emit an index on "${resolved[0].column}"; remove one of them`,
        )
      }
    }

    const fieldsList = resolved
      .map(({ column, sort }) =>
        sort ? `${column}(sort: ${sort === 'asc' ? 'Asc' : 'Desc'})` : column,
      )
      .join(', ')
    const mapArg = index.name ? `, map: "${index.name}"` : ''
    const attribute = index.unique ? '@@unique' : '@@index'

    return `  ${attribute}([${fieldsList}]${mapArg})`
  })
}

/**
 * Generate Prisma schema from OpenSaas config
 *
 * @param prismaClientOutput - Module specifier for the patched Prisma client's
 *   `generator { output }`, relative to the schema file's directory. Defaults to
 *   the legacy `../<opensaasPath>/prisma-client` so existing projects are
 *   unaffected; the output-path resolver supplies a recomputed value when the
 *   schema or `.opensaas` dir is relocated via the `output` config block.
 */
export function generatePrismaSchema(config: OpenSaasConfig, prismaClientOutput?: string): string {
  const lines: string[] = []

  const opensaasPath = config.opensaasPath || '.opensaas'
  const clientOutput = prismaClientOutput ?? `../${opensaasPath}/prisma-client`
  // Keystone-compat mode: when on, non-null text without an explicit default
  // gets Keystone's implicit empty-string default. Threaded to fields via
  // getPrismaType, the same way provider/listName already reach them.
  const keystoneCompat = config.db.keystoneCompat ?? false

  // Postgres multi-schema: when the datasource declares more than one schema,
  // Prisma requires the `multiSchema` preview feature and a `schemas = [...]`
  // array on the datasource. Each model then carries a `@@schema(...)`.
  const schemas = config.db.schemas
  const multiSchema = Array.isArray(schemas) && schemas.length > 0

  // Prisma generator options for the `.opensaas/prisma-client` subtree. By
  // default we emit `importFileExtension = "ts"` and `moduleFormat = "esm"` so
  // the generated client uses explicit `.ts` import extensions — matching the
  // rest of the `.opensaas` bundle (ADR-0008) and keeping the whole import graph
  // statically resolvable by a bundler. A project can override either value via
  // `db.prismaGeneratorOptions`; any supplied value wins, omitted keys fall back
  // to the `ts`/`esm` defaults.
  const prismaGeneratorOptions = config.db.prismaGeneratorOptions
  const importFileExtension = prismaGeneratorOptions?.importFileExtension ?? 'ts'
  const moduleFormat = prismaGeneratorOptions?.moduleFormat ?? 'esm'

  // Generator and datasource
  lines.push('generator client {')
  lines.push('  provider            = "prisma-client"')
  lines.push(`  output              = "${clientOutput}"`)
  lines.push(`  importFileExtension = "${importFileExtension}"`)
  lines.push(`  moduleFormat        = "${moduleFormat}"`)
  if (multiSchema) {
    lines.push('  previewFeatures     = ["multiSchema"]')
  }
  lines.push('}')
  lines.push('')
  lines.push('datasource db {')
  lines.push(`  provider = "${config.db.provider}"`)
  if (multiSchema) {
    lines.push(`  schemas  = [${schemas.map((s) => `"${s}"`).join(', ')}]`)
  }
  lines.push('}')
  lines.push('')

  // Collect enum definitions from all fields (first pass). In multi-schema mode
  // we also record the schema each enum belongs to: Prisma requires every enum
  // (like every model) to declare an `@@schema(...)`, or it errors with P1012.
  // An enum inherits the schema of its owning list (the model carrying the
  // field), falling back to `public`.
  type EnumDefinition = { values: string[]; schema: string }
  const enumDefinitions: Map<string, EnumDefinition> = new Map()
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
          // The enum lives in the owning model's schema (so an enum used by an
          // `auth`-schema model lands in `auth`, not `public`). Default to
          // `public` when the list declares no schema.
          enumDefinitions.set(result.type, {
            values: result.enumValues,
            schema: listConfig.db?.schema ?? 'public',
          })
        }
      }
    }
  }

  // Generate enum blocks
  for (const [enumName, { values, schema: enumSchema }] of enumDefinitions) {
    lines.push(`enum ${enumName} {`)
    for (const value of values) {
      lines.push(`  ${value}`)
    }
    // In multi-schema mode every enum must declare an `@@schema(...)` or Prisma
    // rejects the schema (P1012). Greenfield (single schema) output is unchanged.
    if (multiSchema) {
      lines.push(`  @@schema("${enumSchema}")`)
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

    // Add id field - singleton lists emit a bare `id Int @id` (no `@default(1)`) to
    // match Keystone 6, which emits no column default for singleton ids (see ADR-0004).
    // Non-singleton lists are unchanged: `id String @id @default(cuid())`.
    if (listConfig.isSingleton) {
      lines.push('  id        Int      @id')
    } else {
      lines.push('  id        String   @id @default(cuid())')
    }

    // Track relationship field names (in declaration order) for later processing
    const relationshipFieldNames: string[] = []

    // Block-level indexes requested by scalar fields (see getFieldIndex)
    const scalarIndexes: { field: string; indexType: boolean | 'unique' }[] = []

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

      // Multi-column fields (e.g. storage image()/file() in Keystone-parity
      // mode) emit several physical columns instead of one. The generator stays
      // neutral: it places whatever lines the field returns, the same way it
      // delegates to relationship fields via getPrismaRelation. See ADR-0006.
      if (fieldConfig.getPrismaColumns) {
        const columns = fieldConfig.getPrismaColumns(fieldName)
        if (columns && columns.length > 0) {
          for (const column of columns) {
            const colMods = (column.modifiers ?? '').trimStart()
            const colNull = colMods.startsWith('?') ? '?' : ''
            let colAttrs = colMods.startsWith('?') ? colMods.slice(1).trimStart() : colMods
            // Append @map to bind the column to its physical name (the live
            // Keystone column). Emitted whenever a `map` is supplied so the
            // mapping is explicit and configurable.
            if (column.map) {
              colAttrs = `${colAttrs ? colAttrs + ' ' : ''}@map("${column.map}")`
            }
            const paddedColName = column.name.padEnd(12)
            lines.push(
              `  ${paddedColName} ${column.type}${colNull}${colAttrs ? ' ' + colAttrs : ''}`,
            )
          }
          continue
        }
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

      const index = getFieldIndex(
        fieldName,
        fieldConfig,
        config.db.provider,
        listName,
        keystoneCompat,
      )
      if (index !== undefined && index !== false) {
        scalarIndexes.push({ field: fieldName, indexType: index })
      }
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

    // Add block-level indexes for scalar fields. Emitted before the foreign-key
    // indexes so the order follows field declaration order (scalars are written
    // above relationships in the model).
    for (const index of scalarIndexes) {
      if (index.indexType === 'unique') {
        lines.push(`  @@unique([${index.field}])`)
      } else if (index.indexType === true) {
        lines.push(`  @@index([${index.field}])`)
      }
    }

    // Add indexes for foreign key fields
    for (const index of foreignKeyIndexes) {
      if (index.indexType === 'unique') {
        lines.push(`  @@unique([${index.foreignKeyField}])`)
      } else if (index.indexType === true) {
        lines.push(`  @@index([${index.foreignKeyField}])`)
      }
    }

    // Add model-level `@@unique`/`@@index` constraints declared via
    // `db.indexes` (#864, #918) — the full form when a name or a sort
    // direction is needed; `isIndexed` above remains the sugar for the
    // unnamed single-column case. Emitted last so a config with no
    // `db.indexes` produces byte-for-byte identical output to before this
    // feature existed.
    lines.push(
      ...generateModelIndexLines(
        listName,
        listConfig,
        relationResults,
        collectFieldLevelIndexColumns(listName, listConfig, relationResults),
      ),
    )

    // Map the model to a custom table name when configured (e.g. adopting
    // existing tables whose physical name differs from the list key).
    if (listConfig.db?.map) {
      lines.push(`  @@map("${listConfig.db.map}")`)
    }

    // Place the model in a specific database schema (Postgres multi-schema).
    // In multi-schema mode every model must declare an `@@schema(...)` or Prisma
    // rejects the schema (P1012). A list inherits its own `db.schema` when set,
    // otherwise it defaults to `public` (mirroring the enum default added in
    // #504). Greenfield (single schema) output is unchanged — no `@@schema`.
    if (multiSchema) {
      lines.push(`  @@schema("${listConfig.db?.schema ?? 'public'}")`)
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
 *
 * @param prismaClientOutput - Optional override for the patched Prisma client
 *   output path, forwarded to {@link generatePrismaSchema}.
 */
export function writePrismaSchema(
  config: OpenSaasConfig,
  outputPath: string,
  prismaClientOutput?: string,
): void {
  const schema = generatePrismaSchema(config, prismaClientOutput)

  // Ensure directory exists
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(outputPath, schema, 'utf-8')
}
