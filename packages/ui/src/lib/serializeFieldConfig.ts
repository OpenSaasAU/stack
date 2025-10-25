import type { FieldConfig } from '@opensaas/stack-core'
import type { ComponentType } from 'react'

/**
 * Serializable field config for client components
 * Strips out functions and non-serializable properties
 */
export type SerializableFieldConfig = {
  type: string
  label?: string
  validation?: {
    isRequired?: boolean
    length?: { min?: number; max?: number }
    min?: number
    max?: number
  }
  options?: Array<{ label: string; value: string }>
  many?: boolean
  ref?: string
  ui?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component?: ComponentType<any>
    fieldType?: string
    [key: string]: unknown
  }
}

/**
 * Extract only serializable properties from a single field config
 * Removes functions (getZodSchema, getPrismaType, getTypeScriptType)
 * and non-serializable properties (access, hooks, typePatch, valueForClientSerialization)
 */
export function serializeFieldConfig(fieldConfig: FieldConfig): SerializableFieldConfig {
  const config: SerializableFieldConfig = {
    type: fieldConfig.type,
  }

  // Process ui options, excluding the valueForClientSerialization function
  if (fieldConfig.ui) {
    const { valueForClientSerialization, ...serializableUi } = fieldConfig.ui
    config.ui = serializableUi
  }

  // Extract label if present
  if ('label' in fieldConfig && fieldConfig.label !== undefined) {
    config.label = fieldConfig.label as string
  }

  // Extract validation if present
  if ('validation' in fieldConfig && fieldConfig.validation !== undefined) {
    config.validation = fieldConfig.validation as SerializableFieldConfig['validation']
  }

  // Extract options for select fields
  if ('options' in fieldConfig && fieldConfig.options !== undefined) {
    config.options = fieldConfig.options as Array<{ label: string; value: string }>
  }

  // Extract many for relationship fields
  if ('many' in fieldConfig && fieldConfig.many !== undefined) {
    config.many = fieldConfig.many as boolean
  }

  // Extract ref for relationship fields
  if ('ref' in fieldConfig && fieldConfig.ref !== undefined) {
    config.ref = fieldConfig.ref as string
  }

  return config
}

/**
 * Extract only serializable properties from field configs
 * Removes functions (getZodSchema, getPrismaType, getTypeScriptType)
 * and non-serializable properties (access, hooks, typePatch)
 */
export function serializeFieldConfigs(
  fields: Record<string, FieldConfig>,
): Record<string, SerializableFieldConfig> {
  const serialized: Record<string, SerializableFieldConfig> = {}

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    serialized[fieldName] = serializeFieldConfig(fieldConfig)
  }

  return serialized
}
