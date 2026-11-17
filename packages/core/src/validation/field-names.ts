import type { ContractFieldDescriptor, OpenSaasConfig } from '../config/types.js'
import { isRelationshipField } from '../fields/index.js'
import type { ConfigRefusal } from './config-refusal.js'

type FieldConfigOf = OpenSaasConfig['lists'][string]['fields'][string]

/**
 * What a field contributes to the contract, as the member-claim walk reads
 * it. A descriptor that cannot be produced (an unresolvable `ref`, a pack
 * error) is another validator's finding, so it is `undefined` here.
 */
function describe(
  config: OpenSaasConfig,
  listKey: string,
  fieldKey: string,
  field: FieldConfigOf,
): ContractFieldDescriptor | undefined {
  if (!field.getContractField) return undefined
  try {
    return field.getContractField(fieldKey, listKey, config)
  } catch {
    return undefined
  }
}

/**
 * The contract member names a field claims on its model: a relationship's
 * relation name, a stored field's column name(s). A field without a
 * descriptor is taken at its field key.
 */
function memberNames(
  config: OpenSaasConfig,
  listKey: string,
  fieldKey: string,
  field: FieldConfigOf,
): string[] {
  if (field.virtual) return []
  const descriptor = describe(config, listKey, fieldKey, field)
  return descriptor?.kind === 'columns'
    ? descriptor.columns.map((column) => column.name)
    : [fieldKey]
}

const LOGICAL_KEYS = new Set(['AND', 'OR', 'NOT'])
const RELATION_OPERATORS = new Set(['some', 'every', 'none'])

function refuseReservedPartColumns(
  config: OpenSaasConfig,
  listKey: string,
  fieldKey: string,
  field: FieldConfigOf,
): ConfigRefusal[] {
  if (isRelationshipField(field)) return []
  const reserved = memberNames(config, listKey, fieldKey, field).find(
    (name) => name !== fieldKey && LOGICAL_KEYS.has(name),
  )
  if (reserved === undefined) return []
  return [
    {
      listKey,
      entry: `fields.${fieldKey}`,
      reason: 'reserved-field-name',
      message:
        `List "${listKey}": fields.${fieldKey} emits a column named "${reserved}", which is a key of the ` +
        `Where vocabulary, so a where on it would be read as the operator instead. Rename that column.`,
    },
  ]
}

function refuseReservedName(
  listKey: string,
  fieldKey: string,
  field: FieldConfigOf,
): ConfigRefusal[] {
  if (
    LOGICAL_KEYS.has(fieldKey) ||
    (isRelationshipField(field) && RELATION_OPERATORS.has(fieldKey))
  ) {
    return [
      {
        listKey,
        entry: `fields.${fieldKey}`,
        reason: 'reserved-field-name',
        message:
          `List "${listKey}": fields.${fieldKey} is reserved — "${fieldKey}" is a key of the Where vocabulary, ` +
          `so a where on this field would be read as the operator instead. Rename the field.`,
      },
    ]
  }
  if (fieldKey !== 'id') return []
  return [
    {
      listKey,
      entry: 'fields.id',
      reason: 'reserved-field-name',
      message:
        `List "${listKey}": fields.id is reserved — every list's id column is derived from db.idField ` +
        `(ADR-0048) and cannot be declared as a field. Rename the field, or remove it and set ` +
        `db.idField on "${listKey}" if it was meant to shape the primary key.`,
    },
  ]
}

function refuseForeignKeyCollisions(
  config: OpenSaasConfig,
  listKey: string,
  listConfig: OpenSaasConfig['lists'][string],
): ConfigRefusal[] {
  const ownedColumns = new Map<string, string>()
  for (const [fieldKey, field] of Object.entries(listConfig.fields)) {
    if (!isRelationshipField(field)) continue
    const descriptor = describe(config, listKey, fieldKey, field)
    if (descriptor?.kind === 'relation' && descriptor.foreignKey !== undefined) {
      ownedColumns.set(descriptor.foreignKey.name, fieldKey)
    }
  }
  if (ownedColumns.size === 0) return []

  const refusals: ConfigRefusal[] = []
  for (const [fieldKey, field] of Object.entries(listConfig.fields)) {
    for (const name of memberNames(config, listKey, fieldKey, field)) {
      const owner = ownedColumns.get(name)
      if (owner === undefined || owner === fieldKey) continue
      refusals.push({
        listKey,
        entry: `fields.${fieldKey}`,
        reason: 'foreign-key-column-collision',
        message:
          `List "${listKey}": fields.${fieldKey} collides with the foreign-key column "${name}" that ` +
          `fields.${owner} derives for its relationship. Rename fields.${fieldKey}, or remove it and ` +
          `read the key through fields.${owner}.`,
      })
      break
    }
  }
  return refusals
}

function refuseSyntheticCollisions(config: OpenSaasConfig): ConfigRefusal[] {
  const refusals: ConfigRefusal[] = []
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    for (const [fieldKey, field] of Object.entries(listConfig.fields)) {
      if (!isRelationshipField(field)) continue
      const descriptor = describe(config, listKey, fieldKey, field)
      if (descriptor?.kind !== 'relation' || !descriptor.inverse.synthetic) continue
      const { target } = descriptor
      const synthetic = descriptor.inverse.field
      if (!Object.prototype.hasOwnProperty.call(config.lists[target]?.fields ?? {}, synthetic)) {
        continue
      }
      refusals.push({
        listKey: target,
        entry: `fields.${synthetic}`,
        reason: 'synthetic-relation-collision',
        message:
          `List "${target}": fields.${synthetic} collides with the back-relation the list-only ref on ` +
          `"${listKey}.${fieldKey}" synthesises on "${target}". Rename fields.${synthetic}, or make the ` +
          `relationship bidirectional (ref: '${target}.<field>' on "${listKey}.${fieldKey}" with a matching ` +
          `relationship field on "${target}").`,
      })
    }
  }
  return refusals
}

/**
 * Refuse the field names the contract derivation cannot keep apart from the
 * members it derives itself: the Where vocabulary's `AND`/`OR`/`NOT` (and `some`/`every`/`none` on a
 * relationship), `id` (the primary key comes from `db.idField`,
 * ADR-0048), a field whose column name is the `<field>Id` foreign-key column
 * another relationship on the same list owns, and a field named
 * `from_<List>_<field>` where a list-only ref synthesises that back-relation
 * on its target. A declared `createdAt`/`updatedAt` is not refused: it
 * replaces the auto-timestamp column, as the generator has always allowed.
 * Each refusal names the list, the entry and the fix.
 */
export function validateFieldNames(config: OpenSaasConfig): ConfigRefusal[] {
  const refusals: ConfigRefusal[] = []
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    for (const [fieldKey, field] of Object.entries(listConfig.fields)) {
      refusals.push(...refuseReservedName(listKey, fieldKey, field))
      refusals.push(...refuseReservedPartColumns(config, listKey, fieldKey, field))
    }
    refusals.push(...refuseForeignKeyCollisions(config, listKey, listConfig))
  }
  refusals.push(...refuseSyntheticCollisions(config))
  return refusals
}
