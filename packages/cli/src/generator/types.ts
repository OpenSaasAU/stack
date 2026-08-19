import type { OpenSaasConfig, ListConfig, DatabaseConfig, FieldConfig } from '@opensaas/stack-core'
import type { RelationshipField } from '@opensaas/stack-core/fields'
import * as fs from 'fs'
import * as path from 'path'
import { resolveListTimestamps } from './prisma.js'

function mapFieldTypeToTypeScript(field: FieldConfig): string | null {
  if (field.type === 'relationship') {
    return null
  }

  if (field.getTypeScriptType) {
    const result = field.getTypeScriptType()
    return result.type
  }

  throw new Error(`Field type "${field.type}" does not implement getTypeScriptType method`)
}

function isFieldOptional(field: FieldConfig): boolean {
  // Relationships are always nullable
  if (field.type === 'relationship') {
    return true
  }

  if (field.getTypeScriptType) {
    const result = field.getTypeScriptType()
    return result.optional
  }

  return true
}

function getVirtualFieldNames(fields: Record<string, FieldConfig>): string[] {
  return Object.entries(fields)
    .filter(([_, config]) => config.type === 'virtual')
    .map(([name, _]) => name)
}

/**
 * Intersected with Prisma's GetPayload to add virtual fields to query results.
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

  if (virtualFields.length === 0) {
    lines.push('  // No virtual fields defined')
  }

  lines.push('}')

  return lines.join('\n')
}

/**
 * Replaces Prisma's base types with transformed types (e.g., string -> HashedPassword).
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

  if (transformedFields.length === 0) {
    lines.push('  // No transformed fields defined')
  }

  lines.push('}')

  return lines.join('\n')
}

/**
 * Kept for backwards compatibility — `CustomDB` itself uses Prisma's
 * GetPayload + VirtualFields instead.
 */
function generateModelOutputType(
  listName: string,
  // ListConfig is generic over per-list TypeInfo; we only read `db`/`fields`, which are
  // invariant across that generic, so the permissive default arg is intentional.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listConfig: ListConfig<any>,
  dbConfig: DatabaseConfig,
  isSingleton: boolean,
): string {
  const fields = listConfig.fields
  const lines: string[] = []

  lines.push(`export type ${listName}Output = {`)
  // Singleton lists use an Int id (bare `id Int @id`, see ADR-0004) matching
  // Keystone 6, so the TypeScript id type is `number` rather than `string`.
  lines.push(isSingleton ? '  id: number' : '  id: string')

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
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
      if (!tsType) continue

      const optional = isFieldOptional(fieldConfig)
      const nullability = optional ? ' | null' : ''
      lines.push(`  ${fieldName}: ${tsType}${nullability}`)
    }
  }

  // Auto-timestamp columns mirror the Prisma schema: only emitted when timestamps are
  // enabled (off by default — ADR-0004) and not already declared as a field above.
  const timestamps = resolveListTimestamps(listConfig, dbConfig)
  if (timestamps.createdAt) {
    lines.push('  createdAt: Date')
  }
  if (timestamps.updatedAt) {
    lines.push('  updatedAt: Date')
  }
  lines.push('} & ' + listName + 'VirtualFields')

  return lines.join('\n')
}

function generateModelTypeAlias(listName: string): string {
  return `export type ${listName} = ${listName}Output`
}

/**
 * Render a single scalar create/update input member line — the SINGLE source of
 * truth for a scalar field's member shape (name, `?` optionality, TypeScript
 * type, and `| null` nullability).
 *
 * Both the standalone `{List}CreateInput`/`{List}UpdateInput` exports and the
 * call-site write-`data` override (`buildScalarOverrideMembers`) render their
 * scalar members through this helper so the two cannot drift on how a nullable
 * scalar is represented (#608).
 *
 * Nullability: a nullable scalar (`getTypeScriptType().optional`) gets `| null`,
 * matching Prisma's nullable-column input. A required scalar gets neither `?`
 * nor `| null`.
 *
 * Optionality:
 *  - create: optional (`?`) when nullable OR it has a default value. The
 *    `defaultValue === undefined` check is explicit (not truthiness) so a
 *    falsy-but-present default such as `checkbox({ defaultValue: false })` is
 *    still treated as having a default. See #599.
 *  - update: always optional (partial update).
 *
 * Returns `null` for fields whose `getTypeScriptType()` yields no type, so
 * callers can skip them.
 *
 * @param indent - Leading whitespace for the emitted line (call sites differ:
 *   standalone inputs use 2 spaces, the `data` override uses 4).
 */
function renderScalarInputMember(
  fieldName: string,
  fieldConfig: FieldConfig,
  forCreate: boolean,
  indent: string,
): string | null {
  const tsType = mapFieldTypeToTypeScript(fieldConfig)
  if (!tsType) return null

  const nullable = isFieldOptional(fieldConfig)
  const nullability = nullable ? ' | null' : ''

  let optional: string
  if (forCreate) {
    const required = !nullable && fieldConfig.defaultValue === undefined
    optional = required ? '' : '?'
  } else {
    optional = '?'
  }

  return `${indent}${fieldName}${optional}: ${tsType}${nullability}`
}

function generateCreateInputType(listName: string, fields: Record<string, FieldConfig>): string {
  const lines: string[] = []

  lines.push(`export type ${listName}CreateInput = {`)

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    // Virtual fields with resolveInput hooks can handle side effects but don't store data.
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
      // Shared source of truth with the write-`data` override (#608): same
      // optionality + `| null` nullability for nullable scalars.
      const member = renderScalarInputMember(fieldName, fieldConfig, true, '  ')
      if (!member) continue
      lines.push(member)
    }
  }

  lines.push('}')

  return lines.join('\n')
}

/**
 * Decide whether a scalar field should have its write-path `data` type narrowed
 * to the OpenSaaS `getTypeScriptType()` type, or left as Prisma's input type.
 *
 * Most scalar fields are narrowed so that field-level narrowing (e.g.
 * `calendarDay` -> `string`) is a genuine compile error to violate at the
 * `context.db.<list>.create()/update()` call site (#599). Three field shapes are
 * deliberately left on Prisma's input type to avoid regressing valid writes:
 *
 * - `decimal`: OpenSaaS narrows to `Decimal`, but Prisma accepts
 *   `Decimal | number | string`. A strict override would wrongly reject valid
 *   `number`/`string` decimal writes.
 * - `bigInt`: OpenSaaS narrows to `bigint` (issue #907), but Prisma accepts
 *   `bigint | number`. A strict override would wrongly reject a valid `number`
 *   write, the same failure mode as `decimal` above. (`bigInt()`'s own
 *   `getZodSchema` additionally accepts a numeric `string`, coerced to
 *   `bigint` at the access-control boundary — wider than this narrowly-typed
 *   `context.db` call site, which is fine: the boundary is TypeScript's, not
 *   the field's.)
 * - `json`: OpenSaaS narrows to `unknown`, but Prisma's input type carries the
 *   `JsonNull`/`DbNull` sentinels. Overriding to `unknown` would drop them.
 *
 * Multi-column / `resultExtension` storage fields (`getColumnNames`) are also
 * left to Prisma: they back several raw columns rather than a single scalar
 * column, so there is no single OpenSaaS scalar to narrow to. Their raw backing
 * columns are still stripped from the override (see `getScalarOverrideOmitKeys`)
 * so no dangling Prisma keys are left behind — mirroring `generateGetPayload`.
 */
function shouldNarrowScalarWrite(fieldConfig: FieldConfig): boolean {
  if (fieldConfig.type === 'relationship') return false
  if (fieldConfig.virtual) return false
  if (!fieldConfig.getTypeScriptType) return false
  // Keep Prisma's input type for decimal/bigInt/json (see doc comment above).
  if (
    fieldConfig.type === 'decimal' ||
    fieldConfig.type === 'bigInt' ||
    fieldConfig.type === 'json'
  )
    return false
  // Multi-column / storage fields back raw columns, not a single scalar.
  if (typeof fieldConfig.getColumnNames === 'function') return false
  return true
}

/**
 * The Prisma `data` keys to omit before re-adding narrowed scalar members.
 * Includes each narrowed scalar field name plus any raw backing columns of
 * multi-column fields (so no dangling Prisma keys remain after the Omit).
 */
function getScalarOverrideOmitKeys(fields: Record<string, FieldConfig>): string[] {
  const keys: string[] = []
  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (shouldNarrowScalarWrite(fieldConfig)) {
      keys.push(fieldName)
    }
    // Strip raw backing columns of multi-column fields regardless of narrowing:
    // they are assembled from a logical field and must not leak Prisma keys.
    if (typeof fieldConfig.getColumnNames === 'function') {
      keys.push(...fieldConfig.getColumnNames(fieldName))
    }
  }
  return keys
}

/**
 * Build the narrowed scalar member lines for a write `data` override.
 * Each narrowed scalar field uses its OpenSaaS `getTypeScriptType()` type with
 * correct optionality/nullability.
 *
 * @param forCreate - create uses required/optional + default semantics; update
 *   makes every field optional (partial update).
 */
function buildScalarOverrideMembers(
  fields: Record<string, FieldConfig>,
  forCreate: boolean,
): string[] {
  const members: string[] = []
  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (!shouldNarrowScalarWrite(fieldConfig)) continue

    // Shared source of truth with generateCreateInputType / generateUpdateInputType
    // (#608): identical optionality + `| null` nullability rendering. The override
    // uses 4-space indentation since it is nested inside the `data: ... & { ... }`.
    const member = renderScalarInputMember(fieldName, fieldConfig, forCreate, '    ')
    if (!member) continue
    members.push(member)
  }
  return members
}

/**
 * Build the write `data` type for a single-record create/update Args type.
 * Scalars are narrowed to OpenSaaS types while relationship nested writes,
 * unchecked FK fields, and decimal/json keep Prisma's input shape.
 *
 * Shape: `Omit<Prisma.{List}{Create|Update}Args['data'], <omitKeys>> & { <narrowed scalars> }`
 *
 * When there are no narrowable scalars and no backing columns to strip, the
 * Prisma `data` type is used unchanged.
 */
function buildWriteDataType(
  listName: string,
  fields: Record<string, FieldConfig>,
  forCreate: boolean,
): string {
  const argsType = forCreate ? `${listName}CreateArgs` : `${listName}UpdateArgs`
  const prismaData = `Prisma.${argsType}['data']`

  const omitKeys = getScalarOverrideOmitKeys(fields)
  const members = buildScalarOverrideMembers(fields, forCreate)

  if (omitKeys.length === 0 && members.length === 0) {
    return prismaData
  }

  const omitUnion = omitKeys.map((k) => `'${k}'`).join(' | ')
  const base = omitKeys.length > 0 ? `Omit<${prismaData}, ${omitUnion}>` : prismaData

  if (members.length === 0) {
    return base
  }

  return `${base} & {\n${members.join('\n')}\n  }`
}

/**
 * Build a narrowed write input type over an arbitrary Prisma base input type
 * expression (e.g. `Prisma.{List}CreateInput`). Used by the createMany /
 * updateMany variants whose `data` is built from the scalar `*Input` types
 * rather than the single-record `*Args['data']`.
 */
function buildWriteInputOverride(
  prismaBase: string,
  fields: Record<string, FieldConfig>,
  forCreate: boolean,
): string {
  const omitKeys = getScalarOverrideOmitKeys(fields)
  const members = buildScalarOverrideMembers(fields, forCreate)

  if (omitKeys.length === 0 && members.length === 0) {
    return prismaBase
  }

  const omitUnion = omitKeys.map((k) => `'${k}'`).join(' | ')
  const base = omitKeys.length > 0 ? `Omit<${prismaBase}, ${omitUnion}>` : prismaBase

  if (members.length === 0) {
    return base
  }

  return `${base} & {\n${members.join('\n')}\n  }`
}

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
      // Shared source of truth with the write-`data` override (#608): partial
      // update (always optional) with `| null` nullability for nullable scalars.
      const member = renderScalarInputMember(fieldName, fieldConfig, false, '  ')
      if (!member) continue
      lines.push(member)
    }
  }

  lines.push('}')

  return lines.join('\n')
}

function generateWhereInputType(listName: string, _fields: Record<string, FieldConfig>): string {
  return `export type ${listName}WhereInput = Prisma.${listName}WhereInput`
}

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
  lines.push(`        context: BaseContext`)
  lines.push(`      }`)
  lines.push(`    | {`)
  lines.push(`        operation: 'update'`)
  lines.push(`        resolvedData: Prisma.${listName}UpdateInput`)
  lines.push(`        item: ${listName}`)
  lines.push(`        context: BaseContext`)
  lines.push(`      }`)
  lines.push(`  ) => Promise<Prisma.${listName}CreateInput | Prisma.${listName}UpdateInput>`)
  lines.push(`  validateInput?: (args: {`)
  lines.push(`    operation: 'create' | 'update'`)
  lines.push(`    resolvedData: Prisma.${listName}CreateInput | Prisma.${listName}UpdateInput`)
  lines.push(`    item?: ${listName}`)
  lines.push(`    context: BaseContext`)
  lines.push(`    addValidationError: (msg: string) => void`)
  lines.push(`  }) => Promise<void>`)
  lines.push(`  beforeOperation?: (args: {`)
  lines.push(`    operation: 'create' | 'update' | 'delete'`)
  lines.push(`    resolvedData?: Prisma.${listName}CreateInput | Prisma.${listName}UpdateInput`)
  lines.push(`    item?: ${listName}`)
  lines.push(`    context: BaseContext`)
  lines.push(`  }) => Promise<void>`)
  lines.push(`  afterOperation?: (args: {`)
  lines.push(`    operation: 'create' | 'update' | 'delete'`)
  lines.push(`    resolvedData?: Prisma.${listName}CreateInput | Prisma.${listName}UpdateInput`)
  lines.push(`    item?: ${listName}`)
  lines.push(`    context: BaseContext`)
  lines.push(`  }) => Promise<void>`)
  lines.push(`}`)

  return lines.join('\n')
}

function generateSelectType(listName: string, fields: Record<string, FieldConfig>): string {
  const virtualFields = getVirtualFieldNames(fields)
  const relationshipFields = Object.entries(fields)
    .filter(([_, config]) => config.type === 'relationship')
    .map(([name, config]) => ({
      name,
      targetList: (config as RelationshipField).ref.split('.')[0],
    }))

  if (virtualFields.length === 0 && relationshipFields.length === 0) {
    return `/**
 * Select type for ${listName}
 * No virtual fields defined, uses Prisma's Select type directly
 */
export type ${listName}Select = Prisma.${listName}Select`
  }

  const lines: string[] = []

  if (virtualFields.length > 0) {
    virtualFields.forEach((name) => {
      lines.push(`  ${name}?: boolean`)
    })
  }

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
 * Only generates an Include type if the list has relationship fields — Prisma
 * itself only generates Include types for models with relations.
 */
function generateIncludeType(listName: string, fields: Record<string, FieldConfig>): string | null {
  const relationshipFields = Object.entries(fields)
    .filter(([_, config]) => config.type === 'relationship')
    .map(([name, config]) => ({
      name,
      targetList: (config as RelationshipField).ref.split('.')[0],
    }))

  if (relationshipFields.length === 0) {
    return null
  }

  const virtualFields = getVirtualFieldNames(fields)

  const lines: string[] = []

  if (virtualFields.length > 0) {
    virtualFields.forEach((name) => {
      lines.push(`  ${name}?: boolean`)
    })
  }

  relationshipFields.forEach(({ name, targetList }) => {
    lines.push(`  ${name}?: boolean | ${targetList}DefaultArgs`)
  })

  if (lines.length === 0) {
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
 * Always generated, even for lists without virtual fields — CustomDB type
 * signatures stay consistent, and lists without their own virtual fields
 * still need this to support nested relations that have them.
 */
function generateGetPayloadType(listName: string, fields: Record<string, FieldConfig>): string {
  const virtualFields = getVirtualFieldNames(fields)
  const transformedFieldNames = Object.entries(fields)
    .filter(([_, config]) => config.resultExtension)
    .map(([name, _]) => name)

  // Multi-column fields (e.g. storage image()/file() in Keystone-parity mode)
  // back several raw Prisma columns that must be stripped from the public
  // payload: only the assembled logical field (added back via TransformedFields)
  // is exposed. Collect those raw column names for omission. See ADR-0006.
  const multiColumnRawNames = Object.entries(fields).flatMap(([name, config]) =>
    config.getColumnNames ? config.getColumnNames(name) : [],
  )

  const relationshipFields = Object.entries(fields)
    .filter(([_, config]) => config.type === 'relationship')
    .map(([name, config]) => ({
      name,
      targetList: (config as RelationshipField).ref.split('.')[0],
      many: !!(config as RelationshipField).many,
    }))

  const lines: string[] = []

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
  // When virtual fields exist, strip them from T before passing to Prisma so Prisma never
  // tries to resolve a virtual field name (which would produce `never` in its payload type).
  const fieldsToOmit = [
    ...transformedFieldNames,
    ...relationshipFields.map((r) => r.name),
    ...multiColumnRawNames,
  ]
  const prismaT =
    virtualFields.length > 0 ? `StripVirtualFromArgs<T, keyof ${listName}VirtualFields>` : 'T'
  if (fieldsToOmit.length > 0) {
    lines.push(
      `  Omit<Prisma.${listName}GetPayload<${prismaT}>, ${fieldsToOmit.map((n) => `'${n}'`).join(' | ')}> &`,
    )
  } else {
    lines.push(`  Prisma.${listName}GetPayload<${prismaT}> &`)
  }

  if (transformedFieldNames.length > 0) {
    lines.push(`  ${listName}TransformedFields &`)
  }

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
    lines.push(`  {}`)
  }

  return lines.join('\n')
}

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

function generateFindUniqueArgsType(listName: string, fields: Record<string, FieldConfig>): string {
  const hasRelationships = Object.values(fields).some((field) => field.type === 'relationship')

  if (hasRelationships) {
    return `/**
 * Custom FindUniqueArgs for ${listName} with virtual field support in nested relationships
 */
export type ${listName}FindUniqueArgs = Omit<Prisma.${listName}FindUniqueArgs, 'select' | 'include'> & {
  select?: ${listName}Select | null
  include?: ${listName}Include | null
  query?: Fragment<${listName}Output, FieldSelection<${listName}Output>>
}`
  } else {
    return `/**
 * Custom FindUniqueArgs for ${listName} with virtual field support
 */
export type ${listName}FindUniqueArgs = Omit<Prisma.${listName}FindUniqueArgs, 'select'> & {
  select?: ${listName}Select | null
  query?: Fragment<${listName}Output, FieldSelection<${listName}Output>>
}`
  }
}

function generateFindManyArgsType(listName: string, fields: Record<string, FieldConfig>): string {
  const hasRelationships = Object.values(fields).some((field) => field.type === 'relationship')

  if (hasRelationships) {
    return `/**
 * Custom FindManyArgs for ${listName} with virtual field support in nested relationships
 */
export type ${listName}FindManyArgs = Omit<Prisma.${listName}FindManyArgs, 'select' | 'include'> & {
  select?: ${listName}Select | null
  include?: ${listName}Include | null
  query?: Fragment<${listName}Output, FieldSelection<${listName}Output>>
}`
  } else {
    return `/**
 * Custom FindManyArgs for ${listName} with virtual field support
 */
export type ${listName}FindManyArgs = Omit<Prisma.${listName}FindManyArgs, 'select'> & {
  select?: ${listName}Select | null
  query?: Fragment<${listName}Output, FieldSelection<${listName}Output>>
}`
  }
}

function generateFindFirstArgsType(listName: string, fields: Record<string, FieldConfig>): string {
  const hasRelationships = Object.values(fields).some((field) => field.type === 'relationship')

  if (hasRelationships) {
    return `/**
 * Custom FindFirstArgs for ${listName} with virtual field support in nested relationships
 */
export type ${listName}FindFirstArgs = Omit<Prisma.${listName}FindFirstArgs, 'select' | 'include'> & {
  select?: ${listName}Select | null
  include?: ${listName}Include | null
  query?: Fragment<${listName}Output, FieldSelection<${listName}Output>>
}`
  } else {
    return `/**
 * Custom FindFirstArgs for ${listName} with virtual field support
 */
export type ${listName}FindFirstArgs = Omit<Prisma.${listName}FindFirstArgs, 'select'> & {
  select?: ${listName}Select | null
  query?: Fragment<${listName}Output, FieldSelection<${listName}Output>>
}`
  }
}

/**
 * The same include/query narrowing as FindUniqueArgs, minus `where` (a
 * singleton has no unique selector; there is exactly one row).
 */
function generateGetArgsType(listName: string, fields: Record<string, FieldConfig>): string {
  const hasRelationships = Object.values(fields).some((field) => field.type === 'relationship')

  if (hasRelationships) {
    return `/**
 * Custom Args for ${listName}.get() with virtual field support in nested relationships
 */
export type ${listName}GetArgs = {
  select?: ${listName}Select | null
  include?: ${listName}Include | null
  query?: Fragment<${listName}Output, FieldSelection<${listName}Output>>
}`
  } else {
    return `/**
 * Custom Args for ${listName}.get() with virtual field support
 */
export type ${listName}GetArgs = {
  select?: ${listName}Select | null
  query?: Fragment<${listName}Output, FieldSelection<${listName}Output>>
}`
  }
}

function generateCreateArgsType(listName: string, fields: Record<string, FieldConfig>): string {
  const hasRelationships = Object.values(fields).some((field) => field.type === 'relationship')
  // Narrow scalar `data` members to OpenSaaS types so field-level narrowing
  // (e.g. calendarDay -> string) is a compile error at the call site (#599),
  // while relationship nested writes / decimal / json keep Prisma's shape.
  const dataType = buildWriteDataType(listName, fields, true)

  if (hasRelationships) {
    return `/**
 * Custom CreateArgs for ${listName} with virtual field support in nested relationships
 * The \`data\` member narrows scalar fields to their OpenSaaS types (#599).
 */
export type ${listName}CreateArgs = Omit<Prisma.${listName}CreateArgs, 'select' | 'include' | 'data'> & {
  select?: ${listName}Select | null
  include?: ${listName}Include | null
  data: ${dataType}
}`
  } else {
    return `/**
 * Custom CreateArgs for ${listName} with virtual field support
 * The \`data\` member narrows scalar fields to their OpenSaaS types (#599).
 */
export type ${listName}CreateArgs = Omit<Prisma.${listName}CreateArgs, 'select' | 'data'> & {
  select?: ${listName}Select | null
  data: ${dataType}
}`
  }
}

function generateUpdateArgsType(listName: string, fields: Record<string, FieldConfig>): string {
  const hasRelationships = Object.values(fields).some((field) => field.type === 'relationship')
  // See generateCreateArgsType: narrow scalar `data` members (#599).
  const dataType = buildWriteDataType(listName, fields, false)

  if (hasRelationships) {
    return `/**
 * Custom UpdateArgs for ${listName} with virtual field support in nested relationships
 * The \`data\` member narrows scalar fields to their OpenSaaS types (#599).
 */
export type ${listName}UpdateArgs = Omit<Prisma.${listName}UpdateArgs, 'select' | 'include' | 'data'> & {
  select?: ${listName}Select | null
  include?: ${listName}Include | null
  data: ${dataType}
}`
  } else {
    return `/**
 * Custom UpdateArgs for ${listName} with virtual field support
 * The \`data\` member narrows scalar fields to their OpenSaaS types (#599).
 */
export type ${listName}UpdateArgs = Omit<Prisma.${listName}UpdateArgs, 'select' | 'data'> & {
  select?: ${listName}Select | null
  data: ${dataType}
}`
  }
}

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

function generateCreateManyArgsType(listName: string, fields: Record<string, FieldConfig>): string {
  const hasRelationships = Object.values(fields).some((field) => field.type === 'relationship')
  // createMany `data` is an array of scalar inputs; narrow each element (#599).
  const dataElement = buildWriteInputOverride(`Prisma.${listName}CreateInput`, fields, true)

  if (hasRelationships) {
    return `/**
 * Custom CreateManyArgs for ${listName} with virtual field support in nested relationships
 * Each \`data\` element narrows scalar fields to their OpenSaaS types (#599).
 */
export type ${listName}CreateManyArgs = {
  data: Array<${dataElement}>
  select?: ${listName}Select | null
  include?: ${listName}Include | null
}`
  } else {
    return `/**
 * Custom CreateManyArgs for ${listName} with virtual field support
 * Each \`data\` element narrows scalar fields to their OpenSaaS types (#599).
 */
export type ${listName}CreateManyArgs = {
  data: Array<${dataElement}>
  select?: ${listName}Select | null
}`
  }
}

function generateUpdateManyArgsType(listName: string, fields: Record<string, FieldConfig>): string {
  const hasRelationships = Object.values(fields).some((field) => field.type === 'relationship')
  // updateMany `data` is a single partial scalar input; narrow it (#599).
  const dataType = buildWriteInputOverride(`Prisma.${listName}UpdateInput`, fields, false)

  if (hasRelationships) {
    return `/**
 * Custom UpdateManyArgs for ${listName} with virtual field support in nested relationships
 * The \`data\` member narrows scalar fields to their OpenSaaS types (#599).
 */
export type ${listName}UpdateManyArgs = {
  where?: ${listName}WhereInput
  data: ${dataType}
  select?: ${listName}Select | null
  include?: ${listName}Include | null
}`
  } else {
    return `/**
 * Custom UpdateManyArgs for ${listName} with virtual field support
 * The \`data\` member narrows scalar fields to their OpenSaaS types (#599).
 */
export type ${listName}UpdateManyArgs = {
  where?: ${listName}WhereInput
  data: ${dataType}
  select?: ${listName}Select | null
}`
  }
}

/**
 * Generate the named CRUD interface for a single list — extracted out of
 * `CustomDB` (rather than inlined as an anonymous object-literal member) so
 * TypeScript resolves it as its own lazily-checked symbol. See #952 / ADR-0032:
 * an anonymous per-list block inlined directly into one large `CustomDB`
 * intersection, combined with the self-referential `Context.sudo(): Context`
 * return type, hit `TS2589: Type instantiation is excessively deep` once a
 * schema grew past ~7-8 lists.
 *
 * Every method below is generic over its own `*Args` type, to preserve
 * Prisma's conditional return type together with the virtual-field-aware
 * `GetPayload` — `count` is the only exception, since it returns a plain number.
 */
function generateListCrudInterface(listName: string, isSingleton: boolean): string {
  const lines: string[] = []

  lines.push(`/**`)
  lines.push(` * Access-controlled CRUD methods for ${listName}, with virtual field support.`)
  lines.push(` */`)
  lines.push(`export interface ${listName}Crud {`)

  lines.push(`  findUnique: <T extends ${listName}FindUniqueArgs>(`)
  lines.push(`    args: Prisma.SelectSubset<T, ${listName}FindUniqueArgs>`)
  lines.push(`  ) => Promise<${listName}GetPayload<T> | null>`)

  lines.push(`  findFirst: <T extends ${listName}FindFirstArgs>(`)
  lines.push(`    args?: Prisma.SelectSubset<T, ${listName}FindFirstArgs>`)
  lines.push(`  ) => Promise<${listName}GetPayload<T> | null>`)

  lines.push(`  findMany: <T extends ${listName}FindManyArgs>(`)
  lines.push(`    args?: Prisma.SelectSubset<T, ${listName}FindManyArgs>`)
  lines.push(`  ) => Promise<Array<${listName}GetPayload<T>>>`)

  lines.push(`  create: <T extends ${listName}CreateArgs>(`)
  lines.push(`    args: Prisma.SelectSubset<T, ${listName}CreateArgs>`)
  lines.push(`  ) => Promise<${listName}GetPayload<T>>`)

  lines.push(`  update: <T extends ${listName}UpdateArgs>(`)
  lines.push(`    args: Prisma.SelectSubset<T, ${listName}UpdateArgs>`)
  lines.push(`  ) => Promise<${listName}GetPayload<T> | null>`)

  lines.push(`  delete: <T extends ${listName}DeleteArgs>(`)
  lines.push(`    args: Prisma.SelectSubset<T, ${listName}DeleteArgs>`)
  lines.push(`  ) => Promise<${listName}GetPayload<T> | null>`)

  lines.push(`  count: (args?: Prisma.${listName}CountArgs) => Promise<number>`)

  lines.push(`  createMany: <T extends ${listName}CreateManyArgs>(`)
  lines.push(`    args: Prisma.SelectSubset<T, ${listName}CreateManyArgs>`)
  lines.push(`  ) => Promise<Array<${listName}GetPayload<T>>>`)

  lines.push(`  updateMany: <T extends ${listName}UpdateManyArgs>(`)
  lines.push(`    args: Prisma.SelectSubset<T, ${listName}UpdateManyArgs>`)
  lines.push(`  ) => Promise<Array<${listName}GetPayload<T>>>`)

  // get - only for singleton lists; accepts the same include/query narrowing
  // as findUnique (minus `where` — a singleton has exactly one row).
  if (isSingleton) {
    lines.push(`  get: <T extends ${listName}GetArgs>(`)
    lines.push(`    args?: Prisma.SelectSubset<T, ${listName}GetArgs>`)
    lines.push(`  ) => Promise<${listName}GetPayload<T> | null>`)
  }

  lines.push(`}`)

  return lines.join('\n')
}

/**
 * Generate the custom DB interface that uses Prisma's conditional types with
 * virtual and transformed fields. This leverages Prisma's GetPayload utility
 * to get correct types based on select/include.
 *
 * `CustomDB` is declared as an `interface` referencing each list's own named
 * `{List}Crud` interface (see `generateListCrudInterface`) rather than as a
 * `type` alias with N per-list object literals hand-unrolled into one
 * intersection — see #952 / ADR-0032.
 */
function generateCustomDBType(config: OpenSaasConfig): string {
  const lines: string[] = []

  // db keys to omit from AccessControlledDB before re-adding each list's own {List}Crud.
  const dbKeys = Object.keys(config.lists).map((listName) => {
    const dbKey = listName.charAt(0).toLowerCase() + listName.slice(1)
    return `'${dbKey}'`
  })

  for (const listName of Object.keys(config.lists)) {
    const isSingleton = !!config.lists[listName]?.isSingleton
    lines.push(generateListCrudInterface(listName, isSingleton))
    lines.push('')
  }

  lines.push('/**')
  lines.push(
    " * Custom DB type that uses Prisma's conditional types with virtual and transformed field support",
  )
  lines.push(
    ' * Types change based on select/include - relationships only present when explicitly included',
  )
  lines.push(' * Virtual fields and transformed fields are added to the base model type')
  lines.push(' */')
  lines.push('export interface CustomDB extends Omit<AccessControlledDB<PrismaClient>, ')
  lines.push(`  ${dbKeys.join(' | ')}`)
  lines.push('> {')

  for (const listName of Object.keys(config.lists)) {
    const dbKey = listName.charAt(0).toLowerCase() + listName.slice(1) // camelCase
    lines.push(`  ${dbKey}: ${listName}Crud`)
  }

  lines.push('}')

  return lines.join('\n')
}

/**
 * Generate BaseContext and Context types that are compatible with AccessContext.
 *
 * Both are declared as `interface`s rather than `type` aliases. `Context`'s
 * `sudo(): Context` return type is self-referential, and a self-referential
 * `type` alias is eagerly expanded wherever it's checked — the same pattern
 * already found (and removed) on the core `AccessContext` interface for
 * breaking TypeScript's structural checking of unrelated generated Prisma
 * types (see `packages/core/CLAUDE.md`). An `interface` is resolved lazily by
 * TypeScript instead, so the self-reference no longer forces eager expansion
 * of the (already large) `CustomDB` it embeds. See #952 / ADR-0032.
 */
function generateContextType(_config: OpenSaasConfig): string {
  const lines: string[] = []

  lines.push('/**')
  lines.push(' * Base context type for services that only need database and session access')
  lines.push(' * Compatible with both AccessContext (from hooks) and Context (from server actions)')
  lines.push(' * Use this type for services that should work in both contexts')
  lines.push(' */')
  lines.push(
    "export interface BaseContext<TSession extends OpensaasSession = OpensaasSession> extends Omit<AccessContext<PrismaClient>, 'db' | 'session'> {",
  )
  lines.push('  db: CustomDB')
  lines.push('  session: TSession')
  lines.push('}')
  lines.push('')

  lines.push('/**')
  lines.push(' * Full context type with server action capabilities and virtual field typing')
  lines.push(' * Extends BaseContext and adds serverAction and sudo methods')
  lines.push(
    ' * Use this type in server actions and components that need full context capabilities',
  )
  lines.push(' */')
  lines.push(
    'export interface Context<TSession extends OpensaasSession = OpensaasSession> extends BaseContext<TSession> {',
  )
  lines.push('  serverAction: (props: ServerActionProps) => Promise<unknown>')
  lines.push('  sudo: () => Context<TSession>')
  lines.push('}')

  return lines.join('\n')
}

function collectFieldImports(config: OpenSaasConfig): Array<{
  names: string[]
  from: string
  typeOnly: boolean
}> {
  const importsMap = new Map<string, { names: Set<string>; typeOnly: boolean }>()

  for (const listConfig of Object.values(config.lists)) {
    for (const fieldConfig of Object.values(listConfig.fields)) {
      if (fieldConfig.getTypeScriptImports) {
        const imports = fieldConfig.getTypeScriptImports()
        for (const imp of imports) {
          const existing = importsMap.get(imp.from)
          if (existing) {
            imp.names.forEach((name) => existing.names.add(name))
            if (imp.typeOnly === false) {
              existing.typeOnly = false
            }
          } else {
            importsMap.set(imp.from, {
              names: new Set(imp.names),
              typeOnly: imp.typeOnly ?? true,
            })
          }
        }
      }
    }
  }

  return Array.from(importsMap.entries()).map(([from, { names, typeOnly }]) => ({
    names: Array.from(names).sort(),
    from,
    typeOnly,
  }))
}

export function generateTypes(config: OpenSaasConfig): string {
  const lines: string[] = []

  lines.push('/**')
  lines.push(' * Generated types from OpenSaas configuration')
  lines.push(' * DO NOT EDIT - This file is automatically generated')
  lines.push(' */')
  lines.push('')

  // Use alias for Session to avoid conflicts if user has a list named "Session".
  // Session and AccessContext stay on the public root entry point (Session is the
  // module-augmentation target); the rest are unstable runtime plumbing on /internal.
  lines.push(
    "import type { Session as OpensaasSession, AccessContext } from '@opensaas/stack-core'",
  )
  lines.push(
    "import type { StorageUtils, ServerActionProps, AccessControlledDB, Fragment, FieldSelection } from '@opensaas/stack-core/internal'",
  )
  // Relative imports carry an explicit `.ts` extension (see ./extension.ts) so
  // the bundle resolves under a host bundler / plain Node without an
  // `extensionAlias`. See ADR-0008.
  lines.push("import type { PrismaClient, Prisma } from './prisma-client/client.ts'")
  lines.push("import type { PluginServices } from './plugin-types.ts'")

  const fieldImports = collectFieldImports(config)
  for (const imp of fieldImports) {
    const typePrefix = imp.typeOnly ? 'type ' : ''
    const names = imp.names.join(', ')
    lines.push(`import ${typePrefix}{ ${names} } from '${imp.from}'`)
  }

  lines.push('')

  lines.push(
    '// Utility: strips virtual field keys from select/include so Prisma GetPayload never sees them',
  )
  lines.push('type StripVirtualFromArgs<T, VirtualKeys extends string> =')
  lines.push('  T extends { select: infer S extends object }')
  lines.push("    ? Omit<T, 'select'> & { select: Omit<S, VirtualKeys> }")
  lines.push('    : T extends { include: infer I extends object }')
  lines.push("      ? Omit<T, 'include'> & { include: Omit<I, VirtualKeys> }")
  lines.push('      : T')
  lines.push('')

  for (const [listName, listConfig] of Object.entries(config.lists)) {
    // VirtualFields first — needed by the Output type and CustomDB.
    lines.push(generateVirtualFieldsType(listName, listConfig.fields))
    lines.push('')
    // TransformedFields — needed by CustomDB.
    lines.push(generateTransformedFieldsType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateModelOutputType(listName, listConfig, config.db, !!listConfig.isSingleton))
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
    lines.push(generateSelectType(listName, listConfig.fields))
    lines.push('')
    const includeType = generateIncludeType(listName, listConfig.fields)
    if (includeType) {
      lines.push(includeType)
      lines.push('')
    }
    lines.push(generateGetPayloadType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateDefaultArgsType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateFindUniqueArgsType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateFindManyArgsType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateFindFirstArgsType(listName, listConfig.fields))
    lines.push('')
    if (listConfig.isSingleton) {
      lines.push(generateGetArgsType(listName, listConfig.fields))
      lines.push('')
    }
    lines.push(generateCreateArgsType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateUpdateArgsType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateDeleteArgsType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateCreateManyArgsType(listName, listConfig.fields))
    lines.push('')
    lines.push(generateUpdateManyArgsType(listName, listConfig.fields))
    lines.push('')
  }

  lines.push(generateCustomDBType(config))
  lines.push('')

  lines.push(generateContextType(config))

  return lines.join('\n')
}

export function writeTypes(config: OpenSaasConfig, outputPath: string): void {
  const types = generateTypes(config)

  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(outputPath, types, 'utf-8')
}
