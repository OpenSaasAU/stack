import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import { resolveListMember, resolveListMembers } from '../members/list-members.js'

export type McpRelation = {
  via: 'field' | 'foreignKey'
  field: string
  relatedList: string
  many: boolean
  ownsForeignKey: boolean
}

/** The related list `name` on `listKey` reaches, and through what, as the List member resolver answers it. */
export function relationOf(
  config: OpenSaasConfig,
  listKey: string,
  name: string,
): McpRelation | undefined {
  const member = resolveListMember(config, listKey, name)
  if (member === undefined) return undefined
  switch (member.kind) {
    case 'field':
      return member.storage.kind === 'relation'
        ? {
            via: 'field',
            field: member.name,
            relatedList: member.storage.relatedList,
            many: member.storage.many,
            ownsForeignKey: member.storage.foreignKey !== undefined,
          }
        : undefined
    case 'foreignKey':
      return {
        via: 'foreignKey',
        field: member.field,
        relatedList: member.relatedList,
        many: false,
        ownsForeignKey: true,
      }
    case 'partColumn':
    case 'syntheticBackRelation':
    case 'systemField':
      return undefined
    default: {
      const unhandled: never = member
      return unhandled
    }
  }
}

/** The declared relationship field `name` on `listKey`; a foreign-key column is not one. */
export function relationFieldOf(
  config: OpenSaasConfig,
  listKey: string,
  name: string,
): McpRelation | undefined {
  const relation = relationOf(config, listKey, name)
  return relation?.via === 'field' ? relation : undefined
}

/** The declared fields of `listKey`, in declaration order. */
export function declaredFieldsOf(
  config: OpenSaasConfig,
  listKey: string,
): Array<[string, FieldConfig]> {
  const fields: Array<[string, FieldConfig]> = []
  for (const member of resolveListMembers(config, listKey).members.values()) {
    if (member.kind === 'field') fields.push([member.name, member.field])
  }
  return fields
}
