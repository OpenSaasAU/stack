/**
 * Prisma Schema Introspector
 *
 * Parses prisma/schema.prisma and extracts structured information
 * about models, fields, relationships, and enums.
 */

import fs from 'fs-extra'
import path from 'path'
import type { IntrospectedSchema, IntrospectedModel, IntrospectedField } from '../types.js'

export class PrismaIntrospector {
  /**
   * Introspect a Prisma schema file
   */
  async introspect(
    cwd: string,
    schemaPath: string = 'prisma/schema.prisma',
  ): Promise<IntrospectedSchema> {
    const fullPath = path.isAbsolute(schemaPath) ? schemaPath : path.join(cwd, schemaPath)

    if (!(await fs.pathExists(fullPath))) {
      throw new Error(`Schema file not found: ${fullPath}`)
    }

    const schema = await fs.readFile(fullPath, 'utf-8')

    return {
      provider: this.extractProvider(schema),
      models: this.extractModels(schema),
      enums: this.extractEnums(schema),
    }
  }

  /**
   * Extract database provider from datasource block
   */
  private extractProvider(schema: string): string {
    const match = schema.match(/datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/)
    return match ? match[1] : 'unknown'
  }

  /**
   * Extract all model definitions
   */
  private extractModels(schema: string): IntrospectedModel[] {
    const models: IntrospectedModel[] = []

    // Match model blocks
    const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g
    let match

    while ((match = modelRegex.exec(schema)) !== null) {
      const name = match[1]
      const body = match[2]

      const fields = this.extractFields(body)
      const primaryKey = fields.find((f) => f.isId)?.name || 'id'

      models.push({
        name,
        fields,
        hasRelations: fields.some((f) => f.relation !== undefined),
        primaryKey,
      })
    }

    return models
  }

  /**
   * Extract fields from a model body
   */
  private extractFields(body: string): IntrospectedField[] {
    const fields: IntrospectedField[] = []
    const lines = body.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()

      // Skip empty lines, comments, and model-level attributes
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) {
        continue
      }

      const field = this.parseFieldLine(trimmed)
      if (field) {
        fields.push(field)
      }
    }

    return fields
  }

  /**
   * Parse a single field line
   */
  private parseFieldLine(line: string): IntrospectedField | null {
    // Basic field pattern: name Type modifiers attributes
    // Examples:
    //   id        String   @id @default(cuid())
    //   title     String
    //   isActive  Boolean? @default(true)
    //   posts     Post[]
    //   author    User     @relation(fields: [authorId], references: [id])

    // Remove comments
    const withoutComment = line.split('//')[0].trim()

    // Match field name and type
    const fieldMatch = withoutComment.match(/^(\w+)\s+(\w+)(\?)?(\[\])?(.*)$/)
    if (!fieldMatch) return null

    const [, name, rawType, optional, isList, rest] = fieldMatch

    // Skip if this looks like an index or other non-field line
    if (['@@', 'index', 'unique'].some((kw) => name.startsWith(kw))) {
      return null
    }

    const field: IntrospectedField = {
      name,
      type: rawType,
      isRequired: !optional,
      isUnique: rest.includes('@unique'),
      isId: rest.includes('@id'),
      isList: !!isList,
    }

    // Extract default value (handle nested parentheses)
    const defaultMatch = rest.match(/@default\(/)
    if (defaultMatch) {
      const startIdx = rest.indexOf('@default(') + '@default('.length
      let depth = 1
      let endIdx = startIdx

      while (depth > 0 && endIdx < rest.length) {
        if (rest[endIdx] === '(') depth++
        else if (rest[endIdx] === ')') depth--
        if (depth > 0) endIdx++
      }

      field.defaultValue = rest.substring(startIdx, endIdx)
    }

    // Extract relation
    const relationMatch = rest.match(/@relation\(([^)]+)\)/)
    if (relationMatch) {
      const relationBody = relationMatch[1]

      // Parse relation parts
      const fieldsMatch = relationBody.match(/fields:\s*\[([^\]]+)\]/)
      const referencesMatch = relationBody.match(/references:\s*\[([^\]]+)\]/)
      const nameMatch = relationBody.match(/name:\s*"([^"]+)"/) || relationBody.match(/"([^"]+)"/)

      field.relation = {
        name: nameMatch ? nameMatch[1] : '',
        model: rawType,
        fields: fieldsMatch ? fieldsMatch[1].split(',').map((f) => f.trim()) : [],
        references: referencesMatch ? referencesMatch[1].split(',').map((r) => r.trim()) : [],
      }
    }

    return field
  }

  /**
   * Extract enum definitions
   */
  private extractEnums(schema: string): Array<{ name: string; values: string[] }> {
    const enums: Array<{ name: string; values: string[] }> = []

    // Match enum blocks
    const enumRegex = /enum\s+(\w+)\s*\{([^}]+)\}/g
    let match

    while ((match = enumRegex.exec(schema)) !== null) {
      const name = match[1]
      const body = match[2]

      const values = body
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('//'))

      enums.push({ name, values })
    }

    return enums
  }

  /**
   * Map Prisma type to OpenSaaS field type
   */
  mapPrismaTypeToOpenSaas(prismaType: string): { type: string; import: string } {
    const mappings: Record<string, { type: string; import: string }> = {
      String: { type: 'text', import: 'text' },
      Int: { type: 'integer', import: 'integer' },
      Float: { type: 'float', import: 'float' },
      Boolean: { type: 'checkbox', import: 'checkbox' },
      DateTime: { type: 'timestamp', import: 'timestamp' },
      Json: { type: 'json', import: 'json' },
      BigInt: { type: 'text', import: 'text' }, // No native support
      Decimal: { type: 'text', import: 'text' }, // No native support
      Bytes: { type: 'text', import: 'text' }, // No native support
    }

    return mappings[prismaType] || { type: 'text', import: 'text' }
  }

  /**
   * Get warnings for unsupported features
   */
  getWarnings(schema: IntrospectedSchema): string[] {
    const warnings: string[] = []

    // Check for unsupported types
    for (const model of schema.models) {
      for (const field of model.fields) {
        if (['BigInt', 'Decimal', 'Bytes'].includes(field.type)) {
          warnings.push(
            `Field "${model.name}.${field.name}" uses unsupported type "${field.type}" - will be mapped to text()`,
          )
        }
      }
    }

    // Check for composite IDs
    // This would require checking for @@id in the original schema

    return warnings
  }
}
