import type { OpenSaasConfig } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import { checkAccess } from '../access/engine.js'
import { controlFlowPredicateOf, decideAdvertisement } from '../access/decide-advertisement.js'
import { mcpAdvertisement } from './advertise.js'

const heldScopesByContext = new WeakMap<AccessContext, readonly string[]>()

export function bindHeldScopes(context: AccessContext, scopes: readonly string[]): void {
  heldScopesByContext.set(context, scopes)
}

function asScopeList(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : typeof value === 'string' ? [value] : value
}

export function requiredListScopes(
  config: OpenSaasConfig,
  listKey: string,
  kind: 'read' | 'write',
): string[] {
  const listConfig = config.lists[listKey]
  return asScopeList(listConfig?.mcp?.scopes?.[kind] ?? config.mcp?.scopes?.[kind])
}

export function holdsListScope(
  config: OpenSaasConfig,
  listKey: string,
  context: AccessContext,
  kind: 'read' | 'write',
): boolean {
  const held = heldScopesByContext.get(context)
  if (held === undefined) return true
  return requiredListScopes(config, listKey, kind).every((scope) => held.includes(scope))
}

export async function mcpListReachable(
  config: OpenSaasConfig,
  listKey: string,
  context: AccessContext,
  options: { requireReadTool: boolean; requireScope?: 'read' | 'write' },
): Promise<boolean> {
  const listConfig = config.lists[listKey]
  if (!listConfig || listConfig.mcp?.enabled === false) return false
  if (options.requireReadTool) {
    const readTool = listConfig.mcp?.tools?.read ?? config.mcp?.defaultTools?.read ?? true
    if (!readTool) return false
  }
  if (options.requireScope && !holdsListScope(config, listKey, context, options.requireScope)) {
    return false
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
    controlFlowPredicateOf(context, config),
  )
}

/** A list other lists may read, filter or connect through over MCP. */
export function mcpReadableList(
  config: OpenSaasConfig,
  listKey: string,
  context: AccessContext,
): Promise<boolean> {
  return mcpListReachable(config, listKey, context, { requireReadTool: true, requireScope: 'read' })
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
