import type { OpenSaasConfig } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import { checkAccess } from '../access/engine.js'
import { decideAdvertisement } from '../access/decide-advertisement.js'
import { mcpAdvertisement } from './advertise.js'

export async function mcpListReachable(
  config: OpenSaasConfig,
  listKey: string,
  context: AccessContext,
  options: { requireReadTool: boolean },
): Promise<boolean> {
  const listConfig = config.lists[listKey]
  if (!listConfig || listConfig.mcp?.enabled === false) return false
  if (options.requireReadTool) {
    const readTool = listConfig.mcp?.tools?.read ?? config.mcp?.defaultTools?.read ?? true
    if (!readTool) return false
  }
  return decideAdvertisement(
    `${listKey} query access`,
    async () => {
      const answer = await checkAccess(listConfig.access?.operation?.query, {
        session: context.session,
        context,
      })
      return answer !== false
    },
    false,
    mcpAdvertisement,
  )
}

/** A list other lists may read, filter or connect through over MCP. */
export function mcpReadableList(
  config: OpenSaasConfig,
  listKey: string,
  context: AccessContext,
): Promise<boolean> {
  return mcpListReachable(config, listKey, context, { requireReadTool: true })
}

export async function readableLists(
  config: OpenSaasConfig,
  context: AccessContext,
): Promise<ReadonlySet<string>> {
  const reachable = new Set<string>()
  for (const listKey of Object.keys(config.lists)) {
    if (await mcpReadableList(config, listKey, context)) reachable.add(listKey)
  }
  return reachable
}
