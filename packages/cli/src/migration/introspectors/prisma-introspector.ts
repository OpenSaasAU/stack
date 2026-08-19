import fs from 'fs-extra'
import path from 'path'
import type { IntrospectedSchema, IntrospectedModel, IntrospectedField } from '../types.js'

export class PrismaIntrospector {
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

  private extractProvider(schema: string): string {
    const match = schema.match(/datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/)
    return match ? match[1] : 'unknown'
  }

  private extractModels(schema: string): IntrospectedModel[] {
    const models: IntrospectedModel[] = []

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

  private extractFields(body: string): IntrospectedField[] {
    const fields: IntrospectedField[] = []
    const lines = body.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()

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

  private parseFieldLine(line: string): IntrospectedField | null {
    // Basic field pattern: name Type modifiers attributes
    // Examples:
    //   id        String   @id @default(cuid())
    //   title     String
    //   isActive  Boolean? @default(true)
    //   posts     Post[]
    //   author    User     @relation(fields: [authorId], references: [id])

    const withoutComment = line.split('//')[0].trim()

    const fieldMatch = withoutComment.match(/^(\w+)\s+(\w+)(\?)?(\[\])?(.*)$/)
    if (!fieldMatch) return null

    const [, name, rawType, optional, isList, rest] = fieldMatch

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

    const nativeTypeMatch = rest.match(/@db\.(\w+)(?:\(([^)]*)\))?/)
    if (nativeTypeMatch) {
      const [, nativeName, nativeArgs] = nativeTypeMatch
      field.nativeType = {
        name: nativeName,
        args: nativeArgs
          ? nativeArgs
              .split(',')
              .map((arg) => arg.trim())
              .filter(Boolean)
          : [],
      }
    }

    const relationMatch = rest.match(/@relation\(([^)]+)\)/)
    if (relationMatch) {
      const relationBody = relationMatch[1]

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

  private extractEnums(schema: string): Array<{ name: string; values: string[] }> {
    const enums: Array<{ name: string; values: string[] }> = []

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

  mapPrismaTypeToOpenSaas(prismaType: string): { type: string; import: string } {
    const mappings: Record<string, { type: string; import: string }> = {
      String: { type: 'text', import: 'text' },
      Int: { type: 'integer', import: 'integer' },
      Float: { type: 'decimal', import: 'decimal' }, // No native float - mapped to decimal()
      Boolean: { type: 'checkbox', import: 'checkbox' },
      DateTime: { type: 'timestamp', import: 'timestamp' },
      Json: { type: 'json', import: 'json' },
      BigInt: { type: 'bigInt', import: 'bigInt' },
      Decimal: { type: 'decimal', import: 'decimal' },
      Bytes: { type: 'text', import: 'text' }, // No native support
    }

    return mappings[prismaType] || { type: 'text', import: 'text' }
  }

  getWarnings(schema: IntrospectedSchema): string[] {
    const warnings: string[] = []

    for (const model of schema.models) {
      for (const field of model.fields) {
        if (field.type === 'Bytes') {
          warnings.push(
            `Field "${model.name}.${field.name}" uses unsupported type "${field.type}" - will be mapped to text()`,
          )
        }
        if (field.type === 'Float') {
          warnings.push(
            `Field "${model.name}.${field.name}" uses type "Float" - will be mapped to decimal() (a decimal.js Decimal, not a JS number). Review precision/rounding.`,
          )
        }
      }
    }

    // Known limit: composite IDs (@@id) are not checked for or warned about.

    return warnings
  }
}
