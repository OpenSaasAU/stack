// What each usable name on a list is: its List members.
import { isComputedField } from '../config/field-kind.js'
import type {
  ContractFieldDescriptor,
  ContractRelationDescriptor,
  FieldConfig,
  OpenSaasConfig,
} from '../config/types.js'
import { resolveIdStrategy, resolveListTimestamps } from '../contract/strategy.js'
import type { ConfigRefusal, ConfigRefusalReason } from '../validation/config-refusal.js'
import { refuseNonPascalListKeys } from '../validation/database-config.js'
import { validateConfigFields } from '../validation/field-config.js'
import { validateFieldNames } from '../validation/field-names.js'
import { refuseNonIdentifierListKeys } from '../validation/identifier-names.js'
import { validateRelations } from '../validation/relations.js'
import {
  claimDescribedMembers,
  claimListMember,
  claimOrigin,
  MemberClaimRefusal,
  refuseColumnsAliasingRelations,
  startListMemberClaims,
  systemFieldsOf,
  type ListMemberClaims,
  type SystemFieldName,
} from './claims.js'

export type { SystemFieldName } from './claims.js'

export type DeclaredFieldStorage =
  | { kind: 'column'; column: string }
  | { kind: 'columns'; parts: readonly string[] }
  | {
      kind: 'relation'
      relatedList: string
      many: boolean
      foreignKey: string | undefined
      inverse: { field: string; synthetic: boolean }
    }
  | { kind: 'computed' }

export type DeclaredFieldMember = {
  kind: 'field'
  name: string
  field: FieldConfig
  storage: DeclaredFieldStorage
}

export type ForeignKeyMember = {
  kind: 'foreignKey'
  name: string
  field: string
  relatedList: string
  column: string
}

export type PartColumnMember = {
  kind: 'partColumn'
  name: string
  field: string
  column: string
}

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

export type ListMember =
  | DeclaredFieldMember
  | ForeignKeyMember
  | PartColumnMember
  | SyntheticBackRelationMember
  | SystemFieldMember

export interface ListMembers {
  readonly listKey: string
  readonly singleton: boolean
  readonly systemFields: readonly SystemFieldName[]
  readonly members: ReadonlyMap<string, ListMember>
}

const NAME_RELATION_REFUSALS: ReadonlySet<ConfigRefusalReason> = new Set([
  'unknown-relationship-target',
  'inverse-mismatch',
  'many-to-many',
  'self-referencing-field',
  'foreign-key-on-both-sides',
  'non-owning-side-nullability',
])

type SyntheticEntry = { name: string; sourceList: string; sourceField: string }

type DescribedField = { field: FieldConfig; descriptor: ContractFieldDescriptor }

type ConfigState = {
  described: OpenSaasConfig
  refusal: Error | undefined
  descriptors: Map<string, ReadonlyMap<string, DescribedField>>
  synthetics: ReadonlyMap<string, readonly SyntheticEntry[]> | undefined
  lists: Map<string, ListMembers>
}

const states = new WeakMap<OpenSaasConfig, ConfigState>()

function refusalError(refusal: ConfigRefusal): Error {
  return new Error(refusal.message, { cause: refusal })
}

function validationRefusal(config: OpenSaasConfig): Error | undefined {
  const [fieldError] = validateConfigFields(config).filter(
    (error) => error.missingMember === 'getContractField',
  )
  if (fieldError !== undefined) return new Error(fieldError.message, { cause: fieldError })
  const [refusal] = [
    ...refuseNonPascalListKeys(config),
    ...refuseNonIdentifierListKeys(config),
    ...validateFieldNames(config),
    ...validateRelations(config).filter((entry) => NAME_RELATION_REFUSALS.has(entry.reason)),
  ]
  return refusal === undefined ? undefined : refusalError(refusal)
}

function describedOnce(field: FieldConfig): FieldConfig {
  const describe = field.getContractField
  if (describe === undefined) return field
  let described: ContractFieldDescriptor | undefined
  const getContractField: FieldConfig['getContractField'] = (fieldKey, listKey, config) =>
    (described ??= describe.call(field, fieldKey, listKey, config))
  return new Proxy(field, {
    get: (target, key, receiver) =>
      key === 'getContractField' ? getContractField : Reflect.get(target, key, receiver),
  })
}

function describedConfig(config: OpenSaasConfig): OpenSaasConfig {
  const lists: OpenSaasConfig['lists'] = {}
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    const fields: Record<string, FieldConfig> = {}
    for (const [fieldKey, field] of Object.entries(listConfig.fields)) {
      fields[fieldKey] = describedOnce(field)
    }
    lists[listKey] = { ...listConfig, fields }
  }
  return { ...config, lists }
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
  const described = listConfigOf(state.described, listKey).fields
  const descriptors = new Map<string, DescribedField>()
  for (const [fieldKey, field] of Object.entries(listConfigOf(config, listKey).fields)) {
    descriptors.set(fieldKey, {
      field,
      descriptor: describeField(state.described, listKey, fieldKey, described[fieldKey]),
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

function storedColumns(
  descriptors: ReadonlyMap<string, DescribedField>,
): Array<{ name: string; map?: string }> {
  return [...descriptors.values()].flatMap(
    ({ descriptor }): Array<{ name: string; map?: string }> => {
      switch (descriptor.kind) {
        case 'column':
          return [descriptor]
        case 'columns':
          return descriptor.columns
        case 'relation':
          return descriptor.foreignKey === undefined ? [] : [descriptor.foreignKey]
        case 'computed':
          return []
      }
    },
  )
}

function relationNames(
  descriptors: ReadonlyMap<string, DescribedField>,
  synthetics: readonly SyntheticEntry[],
): string[] {
  const declared = [...descriptors].flatMap(([fieldKey, { descriptor }]) =>
    descriptor.kind === 'relation' ? [fieldKey] : [],
  )
  return [...declared, ...synthetics.map((entry) => entry.name)]
}

function claimMembers(config: OpenSaasConfig, state: ConfigState): void {
  const claimsByList = new Map<string, ListMemberClaims>()
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    const claims = startListMemberClaims(resolveListTimestamps(listConfig, config.db))
    claimsByList.set(listKey, claims)
    for (const [fieldKey, { descriptor }] of descriptorsOf(config, state, listKey)) {
      claimDescribedMembers(listKey, claims, fieldKey, descriptor)
    }
  }
  const synthetics = syntheticsOf(config, state)
  for (const [target, entries] of synthetics) {
    const claims = claimsByList.get(target)
    if (claims === undefined) continue
    for (const entry of entries) {
      claimListMember(
        target,
        claims,
        entry.name,
        claimOrigin.syntheticBackRelation(entry.sourceList, entry.sourceField),
      )
    }
  }
  for (const listKey of Object.keys(config.lists)) {
    const descriptors = descriptorsOf(config, state, listKey)
    refuseColumnsAliasingRelations(
      listKey,
      storedColumns(descriptors),
      relationNames(descriptors, synthetics.get(listKey) ?? []),
    )
  }
}

function claimRefusal(config: OpenSaasConfig, state: ConfigState): Error | undefined {
  try {
    claimMembers(config, state)
  } catch (error) {
    if (error instanceof MemberClaimRefusal) return error
    throw error
  }
  return undefined
}

function stateOf(config: OpenSaasConfig): ConfigState {
  const known = states.get(config)
  if (known !== undefined) return known
  const described = describedConfig(config)
  const state: ConfigState = {
    described,
    refusal: validationRefusal(described),
    descriptors: new Map(),
    synthetics: undefined,
    lists: new Map(),
  }
  state.refusal ??= claimRefusal(config, state)
  states.set(config, state)
  return state
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

  const systemFields = systemFieldsOf(resolveListTimestamps(listConfig, config.db))
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
 * Every List member of `listKey`. Throws generate's own error for any refusal
 * that changes which names a list has or what they are.
 */
export function resolveListMembers(config: OpenSaasConfig, listKey: string): ListMembers {
  const state = stateOf(config)
  if (state.refusal !== undefined) throw state.refusal
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
