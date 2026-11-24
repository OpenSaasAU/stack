import { readContractDescriptor } from '../config/field-kind.js'
import type { ContractFieldDescriptor, OpenSaasConfig } from '../config/types.js'
import { isRelationshipField } from '../fields/index.js'
import {
  DerivedMemberLedger,
  derivedMemberCollision,
  fieldMemberClaims,
  type DerivedMemberCollision,
} from '../members/claims.js'
import type { ConfigRefusal } from './config-refusal.js'

type FieldConfigOf = OpenSaasConfig['lists'][string]['fields'][string]

type ListDescriptors = ReadonlyMap<string, ContractFieldDescriptor | undefined>

/**
 * Each stored field's contract descriptor, read once. A descriptor that
 * cannot be produced (an unresolvable `ref`, a pack error) is another
 * validator's finding, so it is `undefined` here.
 */
function describeLists(config: OpenSaasConfig): Map<string, ListDescriptors> {
  const lists = new Map<string, ListDescriptors>()
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    const fields = new Map<string, ContractFieldDescriptor | undefined>()
    for (const [fieldKey, field] of Object.entries(listConfig.fields)) {
      fields.set(
        fieldKey,
        field.virtual ? undefined : readContractDescriptor(field, fieldKey, listKey, config),
      )
    }
    lists.set(listKey, fields)
  }
  return lists
}

/**
 * The contract member names a field claims on its model: a relationship's
 * relation name, a stored field's column name(s). A field without a
 * descriptor is taken at its field key.
 */
function memberNames(
  descriptors: ListDescriptors,
  fieldKey: string,
  field: FieldConfigOf,
): string[] {
  if (field.virtual) return []
  const descriptor = descriptors.get(fieldKey)
  return descriptor?.kind === 'columns'
    ? descriptor.columns.map((column) => column.name)
    : [fieldKey]
}

const LOGICAL_KEYS = new Set(['AND', 'OR', 'NOT'])
const RELATION_OPERATORS = new Set(['some', 'every', 'none'])

function refuseReservedPartColumns(
  descriptors: ListDescriptors,
  listKey: string,
  fieldKey: string,
  field: FieldConfigOf,
): ConfigRefusal[] {
  if (isRelationshipField(field)) return []
  const reserved = memberNames(descriptors, fieldKey, field).find(
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
  if (fieldKey === '__proto__') {
    return [
      {
        listKey,
        entry: 'fields.__proto__',
        reason: 'reserved-field-name',
        message: `List "${listKey}": fields.__proto__ is reserved — a row cannot carry it as an own key. Rename the field.`,
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

function refuseDerivedMemberCollisions(
  descriptors: ListDescriptors,
  listKey: string,
  listConfig: OpenSaasConfig['lists'][string],
): ConfigRefusal[] {
  const ledger = new DerivedMemberLedger()
  const collisions = new Map<string, DerivedMemberCollision>()
  const fieldKeys = Object.keys(listConfig.fields)
  for (const fieldKey of fieldKeys) {
    for (const claim of fieldMemberClaims(
      fieldKey,
      descriptors.get(fieldKey) ?? { kind: 'computed' },
    )) {
      const collision = ledger.claim(fieldKey, claim)
      if (collision !== undefined && !collisions.has(collision.field)) {
        collisions.set(collision.field, collision)
      }
    }
  }
  return fieldKeys.flatMap((fieldKey): ConfigRefusal[] => {
    const collision = collisions.get(fieldKey)
    if (collision === undefined) return []
    return [
      {
        listKey,
        entry: `fields.${fieldKey}`,
        reason:
          collision.owner.kind === 'foreignKey'
            ? 'foreign-key-column-collision'
            : 'part-column-collision',
        message: derivedMemberCollision(
          listKey,
          fieldKey,
          collision.name,
          collision.owner,
          collision.viaPartColumn,
        ),
      },
    ]
  })
}

function refuseSyntheticCollisions(
  config: OpenSaasConfig,
  described: ReadonlyMap<string, ListDescriptors>,
): ConfigRefusal[] {
  const refusals: ConfigRefusal[] = []
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    for (const [fieldKey, field] of Object.entries(listConfig.fields)) {
      if (!isRelationshipField(field)) continue
      const descriptor = described.get(listKey)?.get(fieldKey)
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
 * another relationship on the same list owns, any field keyed like another
 * field's foreign-key or part column, and a field named
 * `from_<List>_<field>` where a list-only ref synthesises that back-relation
 * on its target. A declared `createdAt`/`updatedAt` is not refused: it
 * replaces the auto-timestamp column, as the generator has always allowed.
 * Each refusal names the list, the entry and the fix.
 */
export function validateFieldNames(config: OpenSaasConfig): ConfigRefusal[] {
  const refusals: ConfigRefusal[] = []
  const described = describeLists(config)
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    const descriptors = described.get(listKey) ?? new Map()
    for (const [fieldKey, field] of Object.entries(listConfig.fields)) {
      refusals.push(...refuseReservedName(listKey, fieldKey, field))
      refusals.push(...refuseReservedPartColumns(descriptors, listKey, fieldKey, field))
    }
    refusals.push(...refuseDerivedMemberCollisions(descriptors, listKey, listConfig))
  }
  refusals.push(...refuseSyntheticCollisions(config, described))
  return refusals
}
