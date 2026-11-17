// The names each list claims, and the refusals when two claims meet.
import type { ContractFieldDescriptor } from '../config/types.js'

export type SystemFieldName = 'id' | 'createdAt' | 'updatedAt'

export type ListMemberClaims = Map<string, string>

export class MemberClaimRefusal extends Error {
  override name = 'MemberClaimRefusal'
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

export function claimDescribedMembers(
  listKey: string,
  claims: ListMemberClaims,
  fieldKey: string,
  descriptor: ContractFieldDescriptor,
): void {
  switch (descriptor.kind) {
    case 'column':
      claimListMember(listKey, claims, descriptor.name, claimOrigin.field(fieldKey))
      return
    case 'columns':
      for (const column of descriptor.columns) {
        claimListMember(listKey, claims, column.name, claimOrigin.field(fieldKey))
      }
      return
    case 'relation':
      claimListMember(listKey, claims, fieldKey, claimOrigin.field(fieldKey))
      if (descriptor.foreignKey !== undefined) {
        claimListMember(
          listKey,
          claims,
          descriptor.foreignKey.name,
          claimOrigin.foreignKey(fieldKey),
        )
      }
      return
    case 'computed':
      return
  }
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
