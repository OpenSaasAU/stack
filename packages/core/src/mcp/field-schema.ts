import type { FieldConfig, OpenSaasConfig, RelationshipField } from '../config/types.js'
import type { AccessContext, Session } from '../access/types.js'
import { classifyRowIndependentWrite } from '../access/field-access.js'
import { decideAdvertisement } from './advertise.js'
import { isRelationshipField, shouldHaveForeignKey } from '../fields/index.js'
import { listIdJsonSchema } from '../contract/id-boundary.js'

/** JSON Schema for one field's own value, as the `create`/`update` `data` schema advertises it. */
export function fieldToJsonSchema(
  fieldName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field configs have varying structures
  fieldConfig: any,
  config: OpenSaasConfig,
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
    case 'relationship': {
      // `null` is the only spelling that clears the edge — nested `disconnect`
      // is refused (ADR-0050) — so the schema has to admit it alongside
      // `connect`, or a client cannot express half of what the write surface
      // supports.
      baseSchema.type = ['object', 'null']
      baseSchema.description =
        'Link this record to a row of the related list with { "connect": { "id": "..." } }, or clear the link with null.'
      // `connect.id` is the RELATED list's own id, at its own type (ADR-0048)
      // — an integer-keyed related list must validate an integer here exactly
      // as `where.id` does on that list's own tools.
      const relatedListKey: string = fieldConfig.ref.split('.')[0]
      baseSchema.properties = {
        connect: {
          type: 'object',
          properties: {
            id: listIdJsonSchema(config, relatedListKey),
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
    }
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
export function ownsForeignKey(
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

export async function generateFieldSchemas(
  listKey: string,
  fields: Record<string, FieldConfig>,
  config: OpenSaasConfig,
  operation: 'create' | 'update',
  session: Session | null,
  context: AccessContext,
): Promise<{
  properties: Record<string, unknown>
  required: string[]
  deniedRequiredField: string | null
}> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  let deniedRequiredField: string | null = null

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

    // `validation.isRequired` is an application-layer check; `db.isNullable:
    // false` is a column-level one — either makes a denied write break every
    // create for this session (#1355), so either drops the `create` tool.
    // Neither implies the other: a column can be non-null with no
    // `isRequired`, or `isRequired` with a nullable column.
    //
    // A `defaultValue` does not need its own exception here: `applyCreateDefaults`
    // (context/apply-defaults.ts) fills an omitted field's default into
    // `resolvedData` before `filterWritableFields` checks write access
    // (write-pipeline.ts), so a denied write on an `isNullable: false` field
    // throws on every create — whether the caller supplied it or relied on
    // the default — not only when the column is genuinely omittable.
    const isRequired =
      operation === 'create' &&
      (('validation' in fieldConfig &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Validation property varies by field type
        !!(fieldConfig.validation as any)?.isRequired) ||
        fieldConfig.db?.isNullable === false)

    const classification = await decideAdvertisement<'allow' | 'deny' | 'row-dependent'>(
      `${listKey}.${fieldName}`,
      () => classifyRowIndependentWrite(fieldConfig.access, operation, { session, context }),
      'deny',
    )
    if (classification === 'deny') {
      if (isRequired) deniedRequiredField ??= fieldName
      continue
    }

    properties[fieldName] = fieldToJsonSchema(fieldName, fieldConfig, config)

    if (isRequired) required.push(fieldName)
  }

  return { properties, required, deniedRequiredField }
}
