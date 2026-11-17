// What each usable name on a list is: its List members.
import { isComputedField } from '../config/field-kind.js'
import type { ContractFieldDescriptor, FieldConfig, OpenSaasConfig } from '../config/types.js'
import { resolveIdStrategy, resolveListTimestamps } from '../contract/strategy.js'
import type { ConfigRefusal, ConfigRefusalReason } from '../validation/config-refusal.js'
import { refuseNonPascalListKeys } from '../validation/database-config.js'
import { validateExtensionPacks } from '../validation/extension-packs.js'
import { validateConfigFields } from '../validation/field-config.js'
import { validateFieldNames } from '../validation/field-names.js'
import { refuseNonIdentifierListKeys } from '../validation/identifier-names.js'
import { validateRelations } from '../validation/relations.js'
import {
  MemberClaimRefusal,
  systemFieldsOf,
  walkContractMembers,
  type SystemFieldName,
} from './claims.js'

export type { SystemFieldName } from './claims.js'

export type MemberColumn = { name: string; column: string }

export type DeclaredFieldStorage =
  | { kind: 'column'; column: string }
  | { kind: 'columns'; parts: readonly MemberColumn[] }
  | {
      kind: 'relation'
      relatedList: string
      many: boolean
      foreignKey: MemberColumn | undefined
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

/** What `field` contributes to the contract, as the member table reads it. */
export type DescribeContractField = (
  listKey: string,
  fieldKey: string,
  field: FieldConfig,
) => ContractFieldDescriptor

type ConfigState = {
  refusal: Error | undefined
  descriptors: WeakMap<FieldConfig, Map<string, ContractFieldDescriptor>>
  synthetics: ReadonlyMap<string, readonly SyntheticEntry[]> | undefined
  lists: Map<string, ListMembers>
}

class DescriptorFailure extends Error {
  constructor(readonly original: unknown) {
    super('getContractField failed')
  }
}

const states = new WeakMap<OpenSaasConfig, ConfigState>()

function refusalError(refusal: ConfigRefusal): Error {
  return new Error(refusal.message, { cause: refusal.cause ?? refusal })
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
    ...validateExtensionPacks(config).filter((entry) => entry.reason === 'field-descriptor-error'),
    ...validateRelations(config).filter((entry) => NAME_RELATION_REFUSALS.has(entry.reason)),
  ]
  return refusal === undefined ? undefined : refusalError(refusal)
}

function listConfigOf(config: OpenSaasConfig, listKey: string): OpenSaasConfig['lists'][string] {
  if (!Object.prototype.hasOwnProperty.call(config.lists, listKey)) {
    throw new Error(`List "${listKey}" is not in the config`)
  }
  return config.lists[listKey]
}

function describe(
  config: OpenSaasConfig,
  state: ConfigState,
  listKey: string,
  fieldKey: string,
  field: FieldConfig,
): ContractFieldDescriptor {
  const key = `${listKey}.${fieldKey}`
  const known = state.descriptors.get(field)?.get(key)
  if (known !== undefined) return known
  let descriptor: ContractFieldDescriptor
  if (isComputedField(field, fieldKey, undefined, undefined) || !field.getContractField) {
    descriptor = { kind: 'computed' }
  } else {
    try {
      descriptor = field.getContractField(fieldKey, listKey, config)
    } catch (error) {
      throw new DescriptorFailure(error)
    }
  }
  const byKey = state.descriptors.get(field) ?? new Map<string, ContractFieldDescriptor>()
  byKey.set(key, descriptor)
  state.descriptors.set(field, byKey)
  return descriptor
}

function syntheticsByTarget(
  config: OpenSaasConfig,
  describeField: DescribeContractField,
): Map<string, SyntheticEntry[]> {
  const byTarget = new Map<string, SyntheticEntry[]>()
  for (const [sourceList, listConfig] of Object.entries(config.lists)) {
    for (const [sourceField, field] of Object.entries(listConfig.fields)) {
      const descriptor = describeField(sourceList, sourceField, field)
      if (descriptor.kind !== 'relation' || !descriptor.inverse.synthetic) continue
      const entries = byTarget.get(descriptor.target) ?? []
      entries.push({ name: descriptor.inverse.field, sourceList, sourceField })
      byTarget.set(descriptor.target, entries)
    }
  }
  return byTarget
}

function syntheticsOf(
  config: OpenSaasConfig,
  state: ConfigState,
): ReadonlyMap<string, readonly SyntheticEntry[]> {
  state.synthetics ??= syntheticsByTarget(config, (listKey, fieldKey, field) =>
    describe(config, state, listKey, fieldKey, field),
  )
  return state.synthetics
}

function claimRefusal(config: OpenSaasConfig, state: ConfigState): Error | undefined {
  try {
    walkContractMembers(config, {
      describe: (listKey, fieldKey, field) => describe(config, state, listKey, fieldKey, field),
    })
  } catch (error) {
    if (error instanceof MemberClaimRefusal) return error
    if (error instanceof DescriptorFailure) {
      return error.original instanceof Error
        ? error.original
        : new Error(String(error.original), { cause: error.original })
    }
    throw error
  }
  return undefined
}

function stateOf(config: OpenSaasConfig): ConfigState {
  const known = states.get(config)
  if (known !== undefined) return known
  const state: ConfigState = {
    refusal: validationRefusal(config),
    descriptors: new WeakMap(),
    synthetics: undefined,
    lists: new Map(),
  }
  state.refusal ??= claimRefusal(config, state)
  states.set(config, state)
  return state
}

function memberColumn(column: { name: string; map?: string }): MemberColumn {
  return { name: column.name, column: column.map ?? column.name }
}

function storageOf(descriptor: ContractFieldDescriptor): DeclaredFieldStorage {
  switch (descriptor.kind) {
    case 'column':
      return { kind: 'column', column: descriptor.map ?? descriptor.name }
    case 'columns':
      return { kind: 'columns', parts: descriptor.columns.map(memberColumn) }
    case 'relation':
      return {
        kind: 'relation',
        relatedList: descriptor.target,
        many: descriptor.many,
        foreignKey:
          descriptor.foreignKey === undefined ? undefined : memberColumn(descriptor.foreignKey),
        inverse: descriptor.inverse,
      }
    case 'computed':
      return { kind: 'computed' }
  }
}

function buildListMembers(
  config: OpenSaasConfig,
  listKey: string,
  describeField: DescribeContractField,
  synthetics: ReadonlyMap<string, readonly SyntheticEntry[]>,
): ListMembers {
  const listConfig = listConfigOf(config, listKey)
  const fields = Object.entries(listConfig.fields).map(([fieldKey, field]) => ({
    fieldKey,
    field,
    descriptor: describeField(listKey, fieldKey, field),
  }))
  const members = new Map<string, ListMember>()
  const add = (member: ListMember): void => {
    if (!members.has(member.name)) members.set(member.name, member)
  }

  for (const { fieldKey, field, descriptor } of fields) {
    add({ kind: 'field', name: fieldKey, field, storage: storageOf(descriptor) })
  }

  const systemFields = systemFieldsOf(resolveListTimestamps(listConfig, config.db))
  for (const name of systemFields) add({ kind: 'systemField', name })

  for (const { fieldKey, descriptor } of fields) {
    if (descriptor.kind === 'relation' && descriptor.foreignKey !== undefined) {
      add({
        kind: 'foreignKey',
        field: fieldKey,
        relatedList: descriptor.target,
        ...memberColumn(descriptor.foreignKey),
      })
    }
    if (descriptor.kind === 'columns') {
      for (const part of descriptor.columns) {
        add({ kind: 'partColumn', field: fieldKey, ...memberColumn(part) })
      }
    }
  }

  for (const entry of synthetics.get(listKey) ?? []) {
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
  const built = buildListMembers(
    config,
    listKey,
    (list, fieldKey, field) => describe(config, state, list, fieldKey, field),
    syntheticsOf(config, state),
  )
  state.lists.set(listKey, built)
  return built
}

/**
 * Every list's List members, built from descriptors the caller already holds
 * rather than resolved and gated. Contract derivation reads its names from
 * this, so it and {@link resolveListMembers} are one table.
 */
export function listMembersFromDescriptors(
  config: OpenSaasConfig,
  describeField: DescribeContractField,
): ReadonlyMap<string, ListMembers> {
  const synthetics = syntheticsByTarget(config, describeField)
  return new Map(
    Object.keys(config.lists).map((listKey) => [
      listKey,
      buildListMembers(config, listKey, describeField, synthetics),
    ]),
  )
}

/** The `default` branch of a position's exhaustive choice over a member's kind. */
export function unhandledMember(member: never): never {
  throw new Error(`Unhandled List member: ${JSON.stringify(member)}`)
}

/** The List member `name` on `listKey`, or `undefined` when the name is not one. */
export function resolveListMember(
  config: OpenSaasConfig,
  listKey: string,
  name: string,
): ListMember | undefined {
  return resolveListMembers(config, listKey).members.get(name)
}
