import type { FieldConfig, OpenSaasConfig } from '../../config/types.js'
import { assertListMembersResolve } from '../../members/list-members.js'

export interface AssemblyDrop {
  mark(field: FieldConfig): FieldConfig
  dropAfterResolution(config: OpenSaasConfig): void
}

export function assemblyDrop(): AssemblyDrop {
  const marked: FieldConfig[] = []
  return {
    mark(field) {
      marked.push(field)
      return field
    },
    dropAfterResolution(config) {
      assertListMembersResolve(config)
      for (const field of marked) delete field.assembleColumns
    },
  }
}
