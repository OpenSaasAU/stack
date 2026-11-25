import type { OpenSaasConfig } from './types.js'

const REMOVED_WRITE_KEYS = ['create', 'update', 'delete'] as const

export function assertNoDefaultWriteTools(config: OpenSaasConfig): OpenSaasConfig {
  const defaultTools = config.mcp?.defaultTools
  if (defaultTools === undefined) return config
  for (const key of REMOVED_WRITE_KEYS) {
    if (key in defaultTools) {
      throw new Error(
        `mcp.defaultTools.${key} is not supported: generated MCP write tools are enabled per list. ` +
          `Remove it, and set lists.<List>.mcp.tools.${key}: true on each list that should expose list_<list>_${key}.`,
      )
    }
  }
  return config
}
