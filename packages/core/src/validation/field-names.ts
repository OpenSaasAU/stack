import type { ContractFieldDescriptor, OpenSaasConfig, RelationshipField } from '../config/types.js'
import {
  getSyntheticFieldName,
  isRelationshipField,
  shouldHaveForeignKey,
} from '../fields/index.js'
import type { ConfigRefusal } from './config-refusal.js'

/**
 * Whether `field` owns its foreign-key column. A ref that does not resolve
 * makes `shouldHaveForeignKey` throw; that is `validateRelations`' finding,
 * so it counts as "no column" here.
 */
function ownsForeignKey(
  config: OpenSaasConfig,
  listKey: string,
  fieldKey: string,
  field: RelationshipField,
): boolean {
  try {
    return shouldHaveForeignKey(listKey, fieldKey, field, config)
  } catch {
    return false
  }
}

/**
 * The contract member names a field claims on its model: a relationship's
 * relation name, a stored field's column name(s). A descriptor that cannot
 * be produced is `validateExtensionPacks`' finding; the field key stands in.
 */
function memberNames(
  config: OpenSaasConfig,
  listKey: string,
  fieldKey: string,
  field: OpenSaasConfig['lists'][string]['fields'][string],
): string[] {
  if (field.virtual) return []
  if (isRelationshipField(field) || !field.getContractField) return [fieldKey]
  let descriptor: ContractFieldDescriptor
  try {
    descriptor = field.getContractField(fieldKey, listKey, config)
  } catch {
    return [fieldKey]
  }
  return descriptor.kind === 'columns'
    ? descriptor.columns.map((column) => column.name)
    : [fieldKey]
}

function refuseReservedName(listKey: string, fieldKey: string): ConfigRefusal[] {
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
    if (!isRelationshipField(field) || field.many) continue
    if (ownsForeignKey(config, listKey, fieldKey, field))
      ownedColumns.set(`${fieldKey}Id`, fieldKey)
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
      if (!isRelationshipField(field) || field.ref.includes('.')) continue
      const synthetic = getSyntheticFieldName(listKey, fieldKey)
      if (!Object.prototype.hasOwnProperty.call(config.lists[field.ref]?.fields ?? {}, synthetic)) {
        continue
      }
      refusals.push({
        listKey: field.ref,
        entry: `fields.${synthetic}`,
        reason: 'synthetic-relation-collision',
        message:
          `List "${field.ref}": fields.${synthetic} collides with the back-relation the list-only ref on ` +
          `"${listKey}.${fieldKey}" synthesises on "${field.ref}". Rename fields.${synthetic}, or make the ` +
          `relationship bidirectional (ref: '${field.ref}.<field>' on "${listKey}.${fieldKey}" with a matching ` +
          `relationship field on "${field.ref}").`,
      })
    }
  }
  return refusals
}

/**
 * Refuse the field names the contract derivation cannot keep apart from the
 * members it derives itself: `id` (the primary key comes from `db.idField`,
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
    for (const fieldKey of Object.keys(listConfig.fields)) {
      refusals.push(...refuseReservedName(listKey, fieldKey))
    }
    refusals.push(...refuseForeignKeyCollisions(config, listKey, listConfig))
  }
  refusals.push(...refuseSyntheticCollisions(config))
  return refusals
}
