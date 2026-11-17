import type { OpenSaasConfig } from '../config/types.js'
import { resolveListMember } from '../members/list-members.js'

export type McpRelation = { relatedList: string; ownsForeignKey: boolean }

/** The declared relationship field `name` on `listKey`, as the List member resolver answers it. */
export function relationMember(
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
            relatedList: member.storage.relatedList,
            ownsForeignKey: member.storage.foreignKey !== undefined,
          }
        : undefined
    case 'foreignKey':
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
