// The names each list claims, and the refusals when two claims meet.
import type {
  ContractColumnDescriptor,
  ContractFieldDescriptor,
  FieldConfig,
  ListConfig,
  OpenSaasConfig,
  TypeInfo,
} from '../config/types.js'
import { resolveListTimestamps } from '../contract/strategy.js'
import type { ContractTimestamps } from '../contract/types.js'

export type SystemFieldName = 'id' | 'createdAt' | 'updatedAt'

export type ListMemberClaims = Map<string, string>

export class MemberClaimRefusal extends Error {
  override name = 'MemberClaimRefusal'
}

export type DerivedMemberOwner = { kind: 'foreignKey' | 'partColumn'; field: string }

export function derivedMemberCollision(
  listKey: string,
  fieldKey: string,
  name: string,
  owner: DerivedMemberOwner,
): string {
  return owner.kind === 'foreignKey'
    ? `List "${listKey}": fields.${fieldKey} collides with the foreign-key column "${name}" that ` +
        `fields.${owner.field} derives for its relationship. Rename fields.${fieldKey}, or remove it and ` +
        `read the key through fields.${owner.field}.`
    : `List "${listKey}": fields.${fieldKey} collides with the part column "${name}" that ` +
        `fields.${owner.field} derives for its multi-column field. Rename fields.${fieldKey}.`
}

export const claimOrigin = {
  field: (fieldKey: string): string => `fields.${fieldKey}`,
  foreignKey: (fieldKey: string): string => `the foreign-key column of fields.${fieldKey}`,
  syntheticBackRelation: (sourceList: string, sourceField: string): string =>
    `the back-relation synthesised for the list-only ref on "${sourceList}.${sourceField}"`,
}

const SYSTEM_FIELD_ORIGINS: Record<SystemFieldName, string> = {
  id: 'the id column',
  createdAt: 'the createdAt auto-timestamp',
  updatedAt: 'the updatedAt auto-timestamp',
}

export function systemFieldsOf(timestamps: {
  createdAt: boolean
  updatedAt: boolean
}): SystemFieldName[] {
  const names: SystemFieldName[] = ['id']
  if (timestamps.createdAt) names.push('createdAt')
  if (timestamps.updatedAt) names.push('updatedAt')
  return names
}

export function startListMemberClaims(timestamps: {
  createdAt: boolean
  updatedAt: boolean
}): ListMemberClaims {
  return new Map(systemFieldsOf(timestamps).map((name) => [name, SYSTEM_FIELD_ORIGINS[name]]))
}

export function claimListMember(
  listKey: string,
  claims: ListMemberClaims,
  name: string,
  origin: string,
): void {
  const existing = claims.get(name)
  if (existing !== undefined) {
    throw new MemberClaimRefusal(
      `List "${listKey}": ${origin} derives the contract member "${name}", which ${existing} already claims on the same model`,
    )
  }
  claims.set(name, origin)
}

export function refuseColumnsAliasingRelations(
  listKey: string,
  columns: Iterable<{ name: string; map?: string }>,
  relationNames: Iterable<string>,
): void {
  const relations = new Set(relationNames)
  for (const column of columns) {
    const physical = column.map ?? column.name
    if (relations.has(physical)) {
      throw new MemberClaimRefusal(
        `List "${listKey}": column "${column.name}" is stored as "${physical}", which is also the ` +
          `name of the relation "${physical}" on the same list. An include is aliased by relation ` +
          `name and a scalar by physical column name, so the two would collide (#1236, ADR-0069). ` +
          `Pick a different db.map or db.foreignKey.map.`,
      )
    }
  }
}

export type SyntheticBackRelationClaim = {
  name: string
  sourceList: string
  sourceField: string
  foreignKey: string
}

export interface ContractMemberWalk {
  describe(
    listKey: string,
    fieldKey: string,
    field: FieldConfig,
  ): ContractFieldDescriptor | undefined
  startList?(
    listKey: string,
    listConfig: ListConfig<TypeInfo>,
    timestamps: ContractTimestamps,
  ): void
  beforeClaim?(
    listKey: string,
    fieldKey: string,
    field: FieldConfig,
    descriptor: ContractFieldDescriptor,
  ): void
  beforePartClaim?(
    listKey: string,
    fieldKey: string,
    field: FieldConfig,
    part: ContractColumnDescriptor,
  ): void
  afterPartClaim?(
    listKey: string,
    fieldKey: string,
    field: FieldConfig,
    part: ContractColumnDescriptor,
  ): void
  afterClaim?(
    listKey: string,
    fieldKey: string,
    field: FieldConfig,
    descriptor: ContractFieldDescriptor,
  ): void
  endList?(listKey: string, listConfig: ListConfig<TypeInfo>): void
  afterSyntheticClaim?(target: string, synthetic: SyntheticBackRelationClaim): void
  readonly synthetics?: ReadonlyMap<string, readonly SyntheticBackRelationClaim[]>
}

type ListWalk = {
  claims: ListMemberClaims
  derived: Map<string, DerivedMemberOwner>
  keys: Set<string>
  columns: Array<{ name: string; map?: string }>
  relations: string[]
}

function claimDerivedMember(
  listKey: string,
  list: ListWalk,
  name: string,
  owner: DerivedMemberOwner,
  origin: string,
): void {
  if (list.keys.has(name)) {
    throw new MemberClaimRefusal(derivedMemberCollision(listKey, name, name, owner))
  }
  claimListMember(listKey, list.claims, name, origin)
  list.derived.set(name, owner)
}

function claimDeclaredKey(listKey: string, list: ListWalk, fieldKey: string): void {
  const owner = list.derived.get(fieldKey)
  if (owner !== undefined) {
    throw new MemberClaimRefusal(derivedMemberCollision(listKey, fieldKey, fieldKey, owner))
  }
  claimListMember(listKey, list.claims, fieldKey, claimOrigin.field(fieldKey))
  list.keys.add(fieldKey)
}

function walkField(
  walk: ContractMemberWalk,
  listKey: string,
  list: ListWalk,
  fieldKey: string,
  field: FieldConfig,
  descriptor: ContractFieldDescriptor,
): void {
  walk.beforeClaim?.(listKey, fieldKey, field, descriptor)
  switch (descriptor.kind) {
    case 'column':
      claimListMember(listKey, list.claims, descriptor.name, claimOrigin.field(fieldKey))
      list.columns.push(descriptor)
      break
    case 'columns':
      for (const part of descriptor.columns) {
        walk.beforePartClaim?.(listKey, fieldKey, field, part)
        if (part.name === fieldKey) {
          claimListMember(listKey, list.claims, part.name, claimOrigin.field(fieldKey))
        } else {
          claimDerivedMember(
            listKey,
            list,
            part.name,
            { kind: 'partColumn', field: fieldKey },
            claimOrigin.field(fieldKey),
          )
        }
        list.columns.push(part)
        walk.afterPartClaim?.(listKey, fieldKey, field, part)
      }
      if (!descriptor.columns.some((part) => part.name === fieldKey)) {
        claimDeclaredKey(listKey, list, fieldKey)
      }
      break
    case 'relation':
      claimListMember(listKey, list.claims, fieldKey, claimOrigin.field(fieldKey))
      list.relations.push(fieldKey)
      if (descriptor.foreignKey !== undefined) {
        claimDerivedMember(
          listKey,
          list,
          descriptor.foreignKey.name,
          { kind: 'foreignKey', field: fieldKey },
          claimOrigin.foreignKey(fieldKey),
        )
        list.columns.push(descriptor.foreignKey)
      }
      break
    case 'computed':
      claimDeclaredKey(listKey, list, fieldKey)
      break
  }
  walk.afterClaim?.(listKey, fieldKey, field, descriptor)
}

export function walkContractMembers(config: OpenSaasConfig, walk: ContractMemberWalk): void {
  const lists = new Map<string, ListWalk>()
  const collected = new Map<string, SyntheticBackRelationClaim[]>()

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    const timestamps = resolveListTimestamps(listConfig, config.db)
    const list: ListWalk = {
      claims: startListMemberClaims(timestamps),
      derived: new Map(),
      keys: new Set(),
      columns: [],
      relations: [],
    }
    lists.set(listKey, list)
    walk.startList?.(listKey, listConfig, timestamps)
    for (const [fieldKey, field] of Object.entries(listConfig.fields)) {
      const descriptor = walk.describe(listKey, fieldKey, field)
      if (descriptor === undefined) continue
      walkField(walk, listKey, list, fieldKey, field, descriptor)
      if (
        walk.synthetics === undefined &&
        descriptor.kind === 'relation' &&
        descriptor.inverse.synthetic &&
        descriptor.foreignKey !== undefined
      ) {
        const entries = collected.get(descriptor.target) ?? []
        entries.push({
          name: descriptor.inverse.field,
          sourceList: listKey,
          sourceField: fieldKey,
          foreignKey: descriptor.foreignKey.name,
        })
        collected.set(descriptor.target, entries)
      }
    }
    walk.endList?.(listKey, listConfig)
  }

  for (const [target, entries] of walk.synthetics ?? collected) {
    const list = lists.get(target)
    if (list === undefined) {
      throw new MemberClaimRefusal(
        `Synthetic back-relation targets list "${target}", which is not in the config`,
      )
    }
    for (const entry of entries) {
      claimListMember(
        target,
        list.claims,
        entry.name,
        claimOrigin.syntheticBackRelation(entry.sourceList, entry.sourceField),
      )
      list.relations.push(entry.name)
      walk.afterSyntheticClaim?.(target, entry)
    }
  }

  for (const [listKey, list] of lists) {
    refuseColumnsAliasingRelations(listKey, list.columns, list.relations)
  }
}
