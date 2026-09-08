import type { FieldConfig, OpenSaasConfig, RelationshipField } from '../config/types.js'
import { isRelationshipField, shouldHaveForeignKey } from '../fields/index.js'

/** JSON Schema for one field's own value, as the `create`/`update` `data` schema advertises it. */
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
      // `null` is the only spelling that clears the edge — nested `disconnect`
      // is refused (ADR-0050) — so the schema has to admit it alongside
      // `connect`, or a client cannot express half of what the write surface
      // supports.
      baseSchema.type = ['object', 'null']
      baseSchema.description =
        'Link this record to a row of the related list with { "connect": { "id": "..." } }, or clear the link with null.'
      baseSchema.properties = {
        connect: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
          additionalProperties: false,
        },
      }
      // `connect` is the object form's only key, and `id` its only criterion:
      // a second key beside either is refused rather than narrowed to the part
      // the engine recognises (`MalformedRelationInputError`). `required` and
      // `additionalProperties` constrain the object form only, so `null`
      // — the other half of the union above — still validates.
      baseSchema.required = ['connect']
      baseSchema.additionalProperties = false
      break
    default:
      baseSchema.type = 'string'
  }

  return baseSchema
}

/**
 * Whether this end of the relationship holds the foreign-key column.
 *
 * `shouldHaveForeignKey` throws on a config `generate` would have refused — a
 * ref naming a list or field that is not declared, or a one-to-one claiming
 * `db.foreignKey` on both ends. `tools/list` lists every list at once, so
 * letting that escape would fail the whole listing over one bad field; an
 * ownership question with no answer is treated as "not this end", which at
 * worst omits a field the engine would have refused anyway.
 */
function ownsForeignKey(
  listKey: string,
  fieldName: string,
  fieldConfig: RelationshipField,
  config: OpenSaasConfig,
): boolean {
  if (!config.lists[fieldConfig.ref.split('.')[0]]) return false
  try {
    return shouldHaveForeignKey(listKey, fieldName, fieldConfig, config)
  } catch {
    return false
  }
}

export function generateFieldSchemas(
  listKey: string,
  fields: Record<string, FieldConfig>,
  config: OpenSaasConfig,
  operation: 'create' | 'update',
): {
  properties: Record<string, unknown>
  required: string[]
} {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (['id', 'createdAt', 'updatedAt'].includes(fieldName)) continue

    // A relationship whose foreign key lives on the related row — a to-many,
    // and the non-owning end of a one-to-one — has no column here to lower a
    // `connect` onto, so the engine refuses it (ADR-0050). Advertising it would
    // invite a tool call that can only fail.
    if (
      isRelationshipField(fieldConfig) &&
      !ownsForeignKey(listKey, fieldName, fieldConfig, config)
    ) {
      continue
    }

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
