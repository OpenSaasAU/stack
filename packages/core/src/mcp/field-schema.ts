import type { OpenSaasConfig } from '../config/types.js'
import type { AccessContext, Session } from '../access/types.js'
import { classifyRowIndependentWrite } from '../access/field-access.js'
import { controlFlowPredicateOf, decideAdvertisement } from '../access/decide-advertisement.js'
import { mcpAdvertisement } from './advertise.js'
import { mcpListReachable } from './reachability.js'
import { declaredFieldsOf, relationFieldOf } from './relation-member.js'
import { isZonelessNativeType } from '../fields/index.js'
import { listIdJsonSchema } from '../contract/id-boundary.js'

function connectSchema(config: OpenSaasConfig, relatedList: string): Record<string, unknown> {
  // `null` is the only spelling that clears the edge — nested `disconnect`
  // is refused (ADR-0050) — so the schema has to admit it alongside `connect`.
  // `connect.id` is the RELATED list's own id, at its own type (ADR-0048).
  // `required` and `additionalProperties` constrain the object form only, so
  // `null` still validates (`MalformedRelationInputError` refuses a second key).
  return {
    type: ['object', 'null'],
    description:
      'Link this record to a row of the related list with { "connect": { "id": "..." } }, or clear the link with null.',
    properties: {
      connect: {
        type: 'object',
        properties: { id: listIdJsonSchema(config, relatedList) },
        required: ['id'],
        additionalProperties: false,
      },
    },
    required: ['connect'],
    additionalProperties: false,
  }
}

/** JSON Schema for one field's own value, as the `create`/`update` `data` schema advertises it. */
export function fieldToJsonSchema(
  fieldName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field configs have varying structures
  fieldConfig: any,
  config: OpenSaasConfig,
  relatedList?: string,
): Record<string, unknown> {
  if (relatedList !== undefined) return connectSchema(config, relatedList)
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
      if (
        !isZonelessNativeType(
          fieldConfig.db?.nativeType ?? config.db.defaults?.timestamp?.nativeType,
        )
      ) {
        baseSchema.format = 'date-time'
      }
      break
    case 'select':
      baseSchema.type = 'string'
      if (fieldConfig.options) {
        baseSchema.enum = fieldConfig.options.map((opt: { value: string }) => opt.value)
      }
      break
    default:
      baseSchema.type = 'string'
  }

  return baseSchema
}

/**
 * Thrown when a `create`/`update` tool's `data` argument names a key the
 * advertised `data` schema does not carry. Caught in the MCP handler and
 * turned into an `isError` tool result, exactly like `McpProjectionRefusedError`
 * on the read side.
 */
export class McpWriteRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpWriteRefusedError'
  }
}

/**
 * Refuses a `data` key the advertised `create`/`update` schema does not
 * carry, with the IDENTICAL message whether the key names no field on this
 * list at all or names a field whose `create`/`update` rule is
 * row-independent and denies this session — the write-side counterpart of
 * `resolveFieldsProjection`'s read-side masking (#1163). Without this, the
 * two cases threw distinguishable messages (`field-level access denied` vs.
 * `it is not a field of this list`), letting a caller enumerate the fields it
 * may not write one probe at a time (#1360).
 *
 * A key that IS advertised — allowed outright, or row-dependent — is left
 * for `context.db`'s own write pipeline to accept or refuse against the real
 * row/payload, so a row-dependent denial still reaches the caller as the
 * write pipeline's own message, unmasked: only row-independent withholding is
 * masked here.
 *
 * A key naming a system field (`id`/`createdAt`/`updatedAt` — never
 * advertised, silently dropped by the write pipeline) or a relationship that
 * doesn't own its foreign key (refused by the write pipeline for a reason
 * unrelated to field access) is left alone too, since masking either would
 * recharacterise a refusal this issue isn't about.
 */
export async function assertWritableData(
  data: Record<string, unknown>,
  listKey: string,
  config: OpenSaasConfig,
  operation: 'create' | 'update',
  session: Session | null,
  context: AccessContext,
): Promise<void> {
  const fieldSchemas = await generateFieldSchemas(listKey, config, operation, session, context)
  const available = Object.keys(fieldSchemas.properties)
  const advertised = new Set(available)

  for (const fieldName of Object.keys(data)) {
    if (advertised.has(fieldName)) continue

    if (relationFieldOf(config, listKey, fieldName)?.ownsForeignKey === false) continue

    throw new McpWriteRefusedError(
      `"${listKey}" has no field "${fieldName}" to ${operation}. Available fields: ${available.join(', ')}.`,
    )
  }
}

export async function generateFieldSchemas(
  listKey: string,
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

  for (const [fieldName, fieldConfig] of declaredFieldsOf(config, listKey)) {
    if (fieldName === 'id') continue

    // A relationship whose foreign key lives on the related row — a to-many,
    // and the non-owning end of a one-to-one — has no column here to lower a
    // `connect` onto, so the engine refuses it (ADR-0050). Advertising it would
    // invite a tool call that can only fail.
    const relation = relationFieldOf(config, listKey, fieldName)
    if (relation?.ownsForeignKey === false) continue

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
      fieldConfig.access?.write !== 'hooks' &&
      (('validation' in fieldConfig &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Validation property varies by field type
        !!(fieldConfig.validation as any)?.isRequired) ||
        fieldConfig.db?.isNullable === false)

    if (
      relation !== undefined &&
      !(await mcpListReachable(config, relation.relatedList, context, {
        requireReadTool: false,
      }))
    ) {
      if (isRequired) deniedRequiredField ??= fieldName
      continue
    }

    const classification = await decideAdvertisement<'allow' | 'deny' | 'row-dependent'>(
      `${listKey}.${fieldName}`,
      () => classifyRowIndependentWrite(fieldConfig.access, operation, { session, context }),
      'deny',
      mcpAdvertisement,
      controlFlowPredicateOf(context, config),
    )
    if (classification === 'deny') {
      if (isRequired) deniedRequiredField ??= fieldName
      continue
    }

    properties[fieldName] = fieldToJsonSchema(fieldName, fieldConfig, config, relation?.relatedList)

    if (isRequired) required.push(fieldName)
  }

  return { properties, required, deniedRequiredField }
}
