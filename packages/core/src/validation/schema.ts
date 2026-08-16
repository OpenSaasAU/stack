import { z } from 'zod'
import type { FieldConfig } from '../config/types.js'

export function generateZodSchema(
  fieldConfigs: Record<string, FieldConfig>,
  operation: 'create' | 'update' = 'create',
): z.ZodObject {
  const shape: Record<string, z.ZodTypeAny> = {}

  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    // Virtual fields don't accept input - they only compute output
    if (
      ['id', 'createdAt', 'updatedAt'].includes(fieldName) ||
      fieldConfig.type === 'relationship' ||
      fieldConfig.virtual
    ) {
      continue
    }

    if (fieldConfig.getZodSchema) {
      shape[fieldName] = fieldConfig.getZodSchema(fieldName, operation)
    } else {
      // Fallback for custom field types without schema generators
      shape[fieldName] = z.any().optional()
    }
  }

  return z.object(shape)
}

export function validateWithZod(
  data: Record<string, unknown>,
  fieldConfigs: Record<string, FieldConfig>,
  operation: 'create' | 'update' = 'create',
): { success: true } | { success: false; errors: Record<string, string> } {
  const schema = generateZodSchema(fieldConfigs, operation)

  const result = schema.safeParse(data)

  if (result.success) {
    return { success: true }
  }

  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const fieldPath = issue.path.join('.')
    errors[fieldPath] = issue.message
  }

  return { success: false, errors }
}
