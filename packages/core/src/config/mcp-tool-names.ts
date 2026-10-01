import type { OpenSaasConfig } from './types.js'
import { getPluginData } from './plugin-engine.js'
import { pascalToCamel } from '../lib/case-utils.js'

const CRUD_OPERATIONS = ['query', 'create', 'update', 'delete'] as const

export function assertUniqueMcpToolNames(config: OpenSaasConfig): OpenSaasConfig {
  const owners = new Map<string, string>()

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    for (const operation of CRUD_OPERATIONS) {
      owners.set(`list_${pascalToCamel(listKey)}_${operation}`, `the built-in ${operation} tool`)
    }
    for (const tool of listConfig.mcp?.customTools ?? []) {
      claim(owners, tool.name, `a custom tool on list "${listKey}"`)
    }
  }

  for (const tool of getPluginData<{ name: string }[]>(config, '__mcpTools') ?? []) {
    claim(owners, tool.name, 'a plugin tool registered with registerMcpTool')
  }

  return config
}

function claim(owners: Map<string, string>, name: string, owner: string): void {
  const existing = owners.get(name)
  if (existing !== undefined) {
    throw new Error(
      `MCP tool name "${name}" is declared by ${owner} but is already taken by ${existing}. Rename the custom tool.`,
    )
  }
  owners.set(name, owner)
}
