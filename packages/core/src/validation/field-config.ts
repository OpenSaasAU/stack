import type { FieldConfig, OpenSaasConfig } from '../config/types.js'

/**
 * A single self-containment violation found on a field.
 *
 * Field builders advertise a self-containment contract: every field provides
 * the generation hooks the schema/type generators delegate to. When a field
 * (often a third-party one) fails to implement a required method, the
 * generators historically threw deep inside generation with an opaque stack
 * trace. This structured error lets the contract be checked up front and
 * reported per-field with enough context to act on.
 */
export interface FieldConfigValidationError {
  /** The list the offending field belongs to (`undefined` when validating a bare field). */
  listKey?: string
  /** The field key (property name) within the list. */
  fieldKey: string
  /** The field's declared `type` discriminator (e.g. `'text'`, `'virtual'`). */
  fieldType: string
  /** The contract method that is missing. */
  missingMethod: 'getPrismaType' | 'getTypeScriptType' | 'getZodSchema' | 'getPrismaRelation'
  /** A human-readable, ready-to-print message naming the list, field, and method. */
  message: string
}

/**
 * Describe a field for an error message. Falls back to a literal when a
 * `type`-less value slips through (e.g. a malformed third-party field).
 */
function describeFieldType(field: FieldConfig): string {
  return typeof field.type === 'string' && field.type.length > 0 ? field.type : 'unknown'
}

/**
 * Type-safe probe for a function-valued property on a field config.
 *
 * The three scalar contract methods live on `BaseFieldConfig` and are checked
 * directly. `getPrismaRelation` only exists on the relationship field variant,
 * so it is probed structurally here without widening the public type or
 * reaching for a cast.
 */
function hasFieldMethod(field: FieldConfig, method: string): boolean {
  const value: unknown = Reflect.get(field, method)
  return typeof value === 'function'
}

function buildMessage(
  fieldType: string,
  method: FieldConfigValidationError['missingMethod'],
  fieldKey: string,
  listKey?: string,
): string {
  const location = listKey ? `Field "${listKey}.${fieldKey}"` : `Field "${fieldKey}"`
  return (
    `${location} (type "${fieldType}") is not self-contained: it does not implement ` +
    `${method}(). Field builders must provide this method so the generator can ` +
    `produce schema and types without inspecting field internals.`
  )
}

/**
 * Validate a single field against the self-containment contract.
 *
 * The contract is conditional on field kind, mirroring exactly where the
 * generators delegate:
 *
 *   - `relationship` fields contribute schema via `getPrismaRelation` and are
 *     skipped by the scalar Prisma/TypeScript/Zod paths, so only
 *     `getPrismaRelation` is required.
 *   - `virtual` fields are not stored in the database, so `getPrismaType` is
 *     legitimately absent; they must still provide `getTypeScriptType` and
 *     `getZodSchema`.
 *   - every other (stored scalar) field must provide `getPrismaType`,
 *     `getTypeScriptType`, and `getZodSchema`.
 *
 * @param field - The field config produced by a field builder.
 * @param fieldKey - The field's key within its list (for messages).
 * @param listKey - The owning list's key (optional, for messages).
 * @returns Zero or more structured errors; empty means the field is compliant.
 */
export function validateFieldConfig(
  field: FieldConfig,
  fieldKey: string,
  listKey?: string,
): FieldConfigValidationError[] {
  const errors: FieldConfigValidationError[] = []
  const fieldType = describeFieldType(field)

  const requireMethod = (method: FieldConfigValidationError['missingMethod']): void => {
    if (!hasFieldMethod(field, method)) {
      errors.push({
        listKey,
        fieldKey,
        fieldType,
        missingMethod: method,
        message: buildMessage(fieldType, method, fieldKey, listKey),
      })
    }
  }

  if (field.type === 'relationship') {
    requireMethod('getPrismaRelation')
    return errors
  }

  if (field.virtual === true || field.type === 'virtual') {
    requireMethod('getTypeScriptType')
    requireMethod('getZodSchema')
    return errors
  }

  requireMethod('getPrismaType')
  requireMethod('getTypeScriptType')
  requireMethod('getZodSchema')

  return errors
}

/**
 * Validate every field across every list in a config.
 *
 * Intended to run once, before any generation, so a misimplemented field
 * surfaces a clear per-field message instead of a deep generator stack trace.
 *
 * @param config - The fully resolved OpenSaas config.
 * @returns All self-containment violations, flattened across lists and fields.
 */
export function validateConfigFields(config: OpenSaasConfig): FieldConfigValidationError[] {
  const errors: FieldConfigValidationError[] = []

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    if (!listConfig?.fields) continue
    for (const [fieldKey, fieldConfig] of Object.entries(listConfig.fields)) {
      errors.push(...validateFieldConfig(fieldConfig, fieldKey, listKey))
    }
  }

  return errors
}
