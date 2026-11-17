import type {
  ContractFieldDescriptor,
  ContractRelationDescriptor,
  FieldConfig,
  OpenSaasConfig,
} from '../config/types.js'
import { isComputedField } from '../config/field-kind.js'
import { deriveContract, resolveIdStrategy, resolveListTimestamps } from '../contract/derive.js'
import { validateConfigFields } from '../validation/field-config.js'
import { validateFieldNames } from '../validation/field-names.js'
import { validateRelations } from '../validation/relations.js'

/** A column every row of a list carries without a declaring field. */
export type SystemFieldName = 'id' | 'createdAt' | 'updatedAt'

/** What a declared field contributes to the contract, as its own descriptor reports it. */
export type DeclaredFieldStorage =
  | { kind: 'column'; column: string }
  | { kind: 'columns'; parts: readonly string[] }
  | {
      kind: 'relation'
      relatedList: string
      many: boolean
      /** The `<field>Id` column this side owns, or `undefined` where it owns none. */
      foreignKey: string | undefined
      inverse: { field: string; synthetic: boolean }
    }
  | { kind: 'computed' }

/** A field the list config declares. */
export type DeclaredFieldMember = {
  kind: 'field'
  name: string
  field: FieldConfig
  storage: DeclaredFieldStorage
}

/** The foreign-key column of a to-one this side owns, spelled `<field>Id`. */
export type ForeignKeyMember = {
  kind: 'foreignKey'
  name: string
  /** The relationship field the column belongs to. */
  field: string
  relatedList: string
  /** The physical column, which differs from `name` under `db.foreignKey.map`. */
  column: string
}

/** A part column of a multi-column field, under a name the field itself does not hold. */
export type PartColumnMember = {
  kind: 'partColumn'
  name: string
  /** The multi-column field the column belongs to. */
  field: string
  /** The physical column, which differs from `name` under the part's own `map`. */
  column: string
}

/** The to-many back-relation a list-only ref on another list synthesises here. */
export type SyntheticBackRelationMember = {
  kind: 'syntheticBackRelation'
  name: string
  sourceList: string
  sourceField: string
  many: true
}

export type SystemFieldMember = {
  kind: 'systemField'
  name: SystemFieldName
}

/** A name a caller can use on a list, in at least one position. */
export type ListMember =
  | DeclaredFieldMember
  | ForeignKeyMember
  | PartColumnMember
  | SyntheticBackRelationMember
  | SystemFieldMember

/** Every List member of one list, with the list-level facts that come with them. */
export interface ListMembers {
  readonly listKey: string
  readonly singleton: boolean
  readonly systemFields: readonly SystemFieldName[]
  readonly members: ReadonlyMap<string, ListMember>
}

type SyntheticEntry = { name: string; sourceList: string; sourceField: string }

type DescribedField = { field: FieldConfig; descriptor: ContractFieldDescriptor }

type ConfigState = {
  described: OpenSaasConfig
  memoised: ReadonlyMap<string, ReadonlyMap<string, FieldConfig>>
  refusal: string | undefined
  descriptors: Map<string, ReadonlyMap<string, DescribedField>>
  synthetics: ReadonlyMap<string, readonly SyntheticEntry[]> | undefined
  lists: Map<string, ListMembers>
}

const states = new WeakMap<OpenSaasConfig, ConfigState>()

function generateRefusal(config: OpenSaasConfig): string | undefined {
  const [fieldError] = validateConfigFields(config)
  if (fieldError !== undefined) return fieldError.message
  const [refusal] = [...validateFieldNames(config), ...validateRelations(config)]
  if (refusal !== undefined) return refusal.message
  try {
    deriveContract(config)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return undefined
}

function describedOnce(field: FieldConfig): FieldConfig {
  const describe = field.getContractField
  if (describe === undefined) return field
  let described: ContractFieldDescriptor | undefined
  return {
    ...field,
    getContractField: (fieldKey, listKey, config) =>
      (described ??= describe.call(field, fieldKey, listKey, config)),
  }
}

function stateOf(config: OpenSaasConfig): ConfigState {
  const known = states.get(config)
  if (known !== undefined) return known
  const memoised = new Map<string, Map<string, FieldConfig>>()
  const lists: OpenSaasConfig['lists'] = {}
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    const fields = new Map<string, FieldConfig>()
    for (const [fieldKey, field] of Object.entries(listConfig.fields)) {
      fields.set(fieldKey, describedOnce(field))
    }
    memoised.set(listKey, fields)
    lists[listKey] = { ...listConfig, fields: Object.fromEntries(fields) }
  }
  const described: OpenSaasConfig = { ...config, lists }
  const state: ConfigState = {
    described,
    memoised,
    refusal: generateRefusal(described),
    descriptors: new Map(),
    synthetics: undefined,
    lists: new Map(),
  }
  states.set(config, state)
  return state
}

function listConfigOf(config: OpenSaasConfig, listKey: string): OpenSaasConfig['lists'][string] {
  if (!Object.prototype.hasOwnProperty.call(config.lists, listKey)) {
    throw new Error(`List "${listKey}" is not in the config`)
  }
  return config.lists[listKey]
}

function describeField(
  config: OpenSaasConfig,
  listKey: string,
  fieldKey: string,
  field: FieldConfig,
): ContractFieldDescriptor {
  if (isComputedField(field, fieldKey, undefined, undefined) || !field.getContractField) {
    return { kind: 'computed' }
  }
  return field.getContractField(fieldKey, listKey, config)
}

function descriptorsOf(
  config: OpenSaasConfig,
  state: ConfigState,
  listKey: string,
): ReadonlyMap<string, DescribedField> {
  const known = state.descriptors.get(listKey)
  if (known !== undefined) return known
  const descriptors = new Map<string, DescribedField>()
  const memoised = state.memoised.get(listKey)
  for (const [fieldKey, field] of Object.entries(listConfigOf(config, listKey).fields)) {
    descriptors.set(fieldKey, {
      field,
      descriptor: describeField(
        state.described,
        listKey,
        fieldKey,
        memoised?.get(fieldKey) ?? field,
      ),
    })
  }
  state.descriptors.set(listKey, descriptors)
  return descriptors
}

function syntheticsOf(
  config: OpenSaasConfig,
  state: ConfigState,
): ReadonlyMap<string, readonly SyntheticEntry[]> {
  if (state.synthetics !== undefined) return state.synthetics
  const byTarget = new Map<string, SyntheticEntry[]>()
  for (const sourceList of Object.keys(config.lists)) {
    for (const [sourceField, { descriptor }] of descriptorsOf(config, state, sourceList)) {
      if (descriptor.kind !== 'relation' || !descriptor.inverse.synthetic) continue
      const entries = byTarget.get(descriptor.target) ?? []
      entries.push({ name: descriptor.inverse.field, sourceList, sourceField })
      byTarget.set(descriptor.target, entries)
    }
  }
  state.synthetics = byTarget
  return byTarget
}

function relationStorage(descriptor: ContractRelationDescriptor): DeclaredFieldStorage {
  return {
    kind: 'relation',
    relatedList: descriptor.target,
    many: descriptor.many,
    foreignKey: descriptor.foreignKey?.name,
    inverse: descriptor.inverse,
  }
}

function storageOf(descriptor: ContractFieldDescriptor): DeclaredFieldStorage {
  switch (descriptor.kind) {
    case 'column':
      return { kind: 'column', column: descriptor.map ?? descriptor.name }
    case 'columns':
      return { kind: 'columns', parts: descriptor.columns.map((column) => column.name) }
    case 'relation':
      return relationStorage(descriptor)
    case 'computed':
      return { kind: 'computed' }
  }
}

function buildListMembers(
  config: OpenSaasConfig,
  state: ConfigState,
  listKey: string,
): ListMembers {
  const listConfig = listConfigOf(config, listKey)
  const descriptors = descriptorsOf(config, state, listKey)
  const members = new Map<string, ListMember>()
  const add = (member: ListMember): void => {
    if (!members.has(member.name)) members.set(member.name, member)
  }

  for (const [fieldKey, { field, descriptor }] of descriptors) {
    add({ kind: 'field', name: fieldKey, field, storage: storageOf(descriptor) })
  }

  const timestamps = resolveListTimestamps(listConfig, config.db)
  const systemFields: SystemFieldName[] = ['id']
  if (timestamps.createdAt) systemFields.push('createdAt')
  if (timestamps.updatedAt) systemFields.push('updatedAt')
  for (const name of systemFields) add({ kind: 'systemField', name })

  for (const [fieldKey, { descriptor }] of descriptors) {
    if (descriptor.kind === 'relation' && descriptor.foreignKey !== undefined) {
      const { foreignKey } = descriptor
      add({
        kind: 'foreignKey',
        name: foreignKey.name,
        field: fieldKey,
        relatedList: descriptor.target,
        column: foreignKey.map ?? foreignKey.name,
      })
    }
    if (descriptor.kind === 'columns') {
      for (const column of descriptor.columns) {
        add({
          kind: 'partColumn',
          name: column.name,
          field: fieldKey,
          column: column.map ?? column.name,
        })
      }
    }
  }

  for (const entry of syntheticsOf(config, state).get(listKey) ?? []) {
    add({ kind: 'syntheticBackRelation', ...entry, many: true })
  }

  return {
    listKey,
    singleton: resolveIdStrategy(listConfig, config) === 'singleton',
    systemFields,
    members,
  }
}

/**
 * Every List member of `listKey`: what each usable name on the list is,
 * decided once per list from each field's own contract descriptor and kept
 * against `config`. Throws the first error `generate` gives for a config it
 * refuses.
 */
export function resolveListMembers(config: OpenSaasConfig, listKey: string): ListMembers {
  const state = stateOf(config)
  if (state.refusal !== undefined) throw new Error(state.refusal)
  const known = state.lists.get(listKey)
  if (known !== undefined) return known
  const built = buildListMembers(config, state, listKey)
  state.lists.set(listKey, built)
  return built
}

/** The List member `name` on `listKey`, or `undefined` when the name is not one. */
export function resolveListMember(
  config: OpenSaasConfig,
  listKey: string,
  name: string,
): ListMember | undefined {
  return resolveListMembers(config, listKey).members.get(name)
}
