import type { FieldConfig } from '../config/types.js'

/** JSON Schema for one field's own value — shared by the create/update `data` schema and the `query` tool's `fields` projection schema. */
export function fieldToJsonSchema(
  fieldName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field configs have varying structures
  fieldConfig: any,
): Record<string, unknown> {
  const baseSchema: Record<string, unknown> = {}

  switch (fieldConfig.type) {
    case 'text':
    case 'password':
      baseSchema.type = 'string'
      if (fieldConfig.validation?.length) {
        if (fieldConfig.validation.length.min)
          baseSchema.minLength = fieldConfig.validation.length.min
        if (fieldConfig.validation.length.max)
          baseSchema.maxLength = fieldConfig.validation.length.max
      }
      break
    case 'integer':
      baseSchema.type = 'number'
      if (fieldConfig.validation?.min !== undefined) baseSchema.minimum = fieldConfig.validation.min
      if (fieldConfig.validation?.max !== undefined) baseSchema.maximum = fieldConfig.validation.max
      break
    case 'checkbox':
      baseSchema.type = 'boolean'
      break
    case 'timestamp':
      baseSchema.type = 'string'
      baseSchema.format = 'date-time'
      break
    case 'select':
      baseSchema.type = 'string'
      if (fieldConfig.options) {
        baseSchema.enum = fieldConfig.options.map((opt: { value: string }) => opt.value)
      }
      break
    case 'relationship':
      baseSchema.type = 'object'
      baseSchema.properties = {
        connect: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
      }
      break
    default:
      baseSchema.type = 'string'
  }

  return baseSchema
}

export function generateFieldSchemas(
  fields: Record<string, FieldConfig>,
  operation: 'create' | 'update',
): {
  properties: Record<string, unknown>
  required: string[]
} {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (['id', 'createdAt', 'updatedAt'].includes(fieldName)) continue

    properties[fieldName] = fieldToJsonSchema(fieldName, fieldConfig)

    if (
      operation === 'create' &&
      'validation' in fieldConfig &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Validation property varies by field type
      (fieldConfig.validation as any)?.isRequired
    ) {
      required.push(fieldName)
    }
  }

  return { properties, required }
}
