import type { OpenSaasConfig } from './types.js'
import { getPluginData } from './plugin-engine.js'

const CRUD_TOOL_NAME = /^list_([a-z][a-zA-Z0-9]*)_(query|create|update|delete)$/

export function assertUniqueMcpToolNames(config: OpenSaasConfig): OpenSaasConfig {
  const owners = new Map<string, string>()

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
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
  if (CRUD_TOOL_NAME.test(name)) {
    throw new Error(
      `MCP tool name "${name}" is declared by ${owner} but matches the reserved list_<list>_<operation> pattern, which always runs a built-in tool. Rename the custom tool.`,
    )
  }
  const existing = owners.get(name)
  if (existing !== undefined) {
    throw new Error(
      `MCP tool name "${name}" is declared by ${owner} but is already taken by ${existing}. Rename the custom tool.`,
    )
  }
  owners.set(name, owner)
}
