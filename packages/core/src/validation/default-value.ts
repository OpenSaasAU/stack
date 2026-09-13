import { isNowSentinel } from '../context/apply-defaults.js'
import type { ContractFieldDescriptor, OpenSaasConfig } from '../config/types.js'
import { isRelationshipField } from '../fields/index.js'
import type { ConfigRefusal } from './config-refusal.js'

function describeDefaultValue(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Refuse an explicit `defaultValue` the field's own create validator would
 * reject: a column default drops the field from the required half of the
 * generated create input (`RequiredCreateColumn`, ADR-0052), so an
 * omitted create for that field would type-check and then throw
 * `ValidationError` once `applyCreateDefaults` fills the value in. This is
 * the explicit spelling of the defect #1295 fixed for `db.keystoneCompat`'s
 * implicit empty-string default — the same question, asked of a
 * hand-written `defaultValue` instead of a synthesised one.
 *
 * A descriptor `getContractField` cannot produce is `validateExtensionPacks`'
 * finding; this check is skipped rather than duplicated there. Only a
 * `kind: 'column'` descriptor that actually carries a `default` is checked —
 * a field that declines to emit one (e.g. `timestamp()`'s `{ kind: 'now' }`
 * sentinel, which the database supplies and validation never sees) has
 * nothing to disagree with the runtime over.
 */
export function validateDefaultValues(config: OpenSaasConfig): ConfigRefusal[] {
  const refusals: ConfigRefusal[] = []

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    for (const [fieldKey, field] of Object.entries(listConfig.fields)) {
      if (field.virtual || isRelationshipField(field) || !field.getContractField) continue
      if (fieldKey === 'id' || fieldKey === 'createdAt' || fieldKey === 'updatedAt') continue
      if (!('defaultValue' in field) || field.defaultValue === undefined) continue
      if (isNowSentinel(field.defaultValue)) continue
      if (!field.getZodSchema) continue

      let descriptor: ContractFieldDescriptor
      try {
        descriptor = field.getContractField(fieldKey, listKey, config)
      } catch {
        continue
      }
      if (descriptor.kind !== 'column' || descriptor.default === undefined) continue

      const result = field.getZodSchema(fieldKey, 'create').safeParse(field.defaultValue)
      if (result.success) continue

      const rule = result.error.issues[0]?.message ?? 'its own validation'
      refusals.push({
        listKey,
        entry: `fields.${fieldKey}`,
        reason: 'default-value-rejected-by-validation',
        message:
          `List "${listKey}": fields.${fieldKey} declares defaultValue ${describeDefaultValue(field.defaultValue)}, ` +
          `which its own validation refuses on create: ${rule}. A column default drops the field from the ` +
          `required half of the generated create input (ADR-0052), so omitting "${fieldKey}" on create would ` +
          `type-check and then throw ValidationError once the default is filled in. Choose a defaultValue for ` +
          `"${listKey}.${fieldKey}" that its own validation accepts, or relax that validation.`,
      })
    }
  }

  return refusals
}
