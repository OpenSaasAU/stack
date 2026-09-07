import type { FieldConfig, OpenSaasConfig } from '../config/types.js'

/**
 * A single self-containment violation found on a field.
 *
 * Field builders advertise a self-containment contract: every field declares
 * what the contract and type generators delegate to it for. When a field
 * (often a third-party one) leaves one out, the generators would otherwise
 * throw deep inside generation with an opaque stack trace. This structured
 * error lets the contract be checked up front and reported per-field with
 * enough context to act on.
 */
export interface FieldConfigValidationError {
  /** The list the offending field belongs to (`undefined` when validating a bare field). */
  listKey?: string
  /** The field key (property name) within the list. */
  fieldKey: string
  /** The field's declared `type` discriminator (e.g. `'text'`, `'virtual'`). */
  fieldType: string
  /** The contract member that is missing. */
  missingMember: 'getContractField' | 'getZodSchema' | 'outputType'
  /** A human-readable, ready-to-print message naming the list, field, and member. */
  message: string
}

/**
 * Describe a field for an error message. Falls back to a literal when a
 * `type`-less value slips through (e.g. a malformed third-party field).
 */
function describeFieldType(field: FieldConfig): string {
  return typeof field.type === 'string' && field.type.length > 0 ? field.type : 'unknown'
}

function hasFieldMethod(field: FieldConfig, method: string): boolean {
  const value: unknown = Reflect.get(field, method)
  return typeof value === 'function'
}

function buildMessage(
  fieldType: string,
  member: FieldConfigValidationError['missingMember'],
  fieldKey: string,
  listKey?: string,
): string {
  const location = listKey ? `Field "${listKey}.${fieldKey}"` : `Field "${fieldKey}"`
  const spelling = member === 'outputType' ? member : `${member}()`
  return (
    `${location} (type "${fieldType}") is not self-contained: it does not declare ` +
    `${spelling}. Field builders must provide this so the generator can produce the ` +
    `contract and types without inspecting field internals.`
  )
}

/**
 * Validate a single field against the self-containment contract.
 *
 * The contract is conditional on field kind, mirroring exactly where the
 * generators delegate:
 *
 *   - `relationship` fields contribute a relation descriptor and take no
 *     input of their own, so only `getContractField` is required.
 *   - `virtual` fields have no column for the contract to type them from, so
 *     they must declare `outputType` (ADR-0052) as well as `getZodSchema`.
 *   - a `columns` field — one field over several physical columns, which
 *     `getColumnNames` is the marker of — has no single column to type it
 *     from either, so it must declare `outputType` too.
 *   - every other (stored scalar) field must provide `getContractField` and
 *     `getZodSchema`; its TypeScript face comes from its contract column, and
 *     `outputType` is an override it may omit.
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

  const requireMember = (
    member: FieldConfigValidationError['missingMember'],
    present: boolean,
  ): void => {
    if (present) return
    errors.push({
      listKey,
      fieldKey,
      fieldType,
      missingMember: member,
      message: buildMessage(fieldType, member, fieldKey, listKey),
    })
  }

  if (field.type === 'relationship') {
    requireMember('getContractField', hasFieldMethod(field, 'getContractField'))
    return errors
  }

  if (field.virtual === true || field.type === 'virtual') {
    requireMember('outputType', field.outputType !== undefined)
    requireMember('getZodSchema', hasFieldMethod(field, 'getZodSchema'))
    return errors
  }

  requireMember('getContractField', hasFieldMethod(field, 'getContractField'))
  if (hasFieldMethod(field, 'getColumnNames')) {
    requireMember('outputType', field.outputType !== undefined)
  }
  requireMember('getZodSchema', hasFieldMethod(field, 'getZodSchema'))

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
