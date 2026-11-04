import type { OpenSaasConfig } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import { checkAccess } from '../access/engine.js'
import { isRelationshipField } from '../fields/index.js'
import { RELATION_QUANTIFIERS } from '../secured/operators.js'
import { unqueryableKey } from '../secured/vocabulary.js'

const LOGICAL_OPERATORS: ReadonlySet<string> = new Set(['AND', 'OR', 'NOT'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The lists a `where` may filter through: MCP-enabled, `tools.read` on, and not denied outright to this session. */
export async function queryReachableLists(
  config: OpenSaasConfig,
  context: AccessContext,
): Promise<ReadonlySet<string>> {
  const reachable = new Set<string>()
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    if (listConfig.mcp?.enabled === false) continue
    const readTool = listConfig.mcp?.tools?.read ?? config.mcp?.defaultTools?.read ?? true
    if (!readTool) continue
    const answer = await checkAccess(listConfig.access?.operation?.query, {
      session: context.session,
      context,
    })
    if (answer !== false) reachable.add(listKey)
  }
  return reachable
}

function relationTarget(config: OpenSaasConfig, listKey: string, key: string): string | undefined {
  const declared = config.lists[listKey]?.fields[key]
  if (isRelationshipField(declared)) return declared.ref.split('.')[0]

  for (const [sourceKey, sourceConfig] of Object.entries(config.lists)) {
    for (const [fieldName, fieldConfig] of Object.entries(sourceConfig.fields)) {
      if (!isRelationshipField(fieldConfig) || fieldConfig.ref.includes('.')) continue
      if (fieldConfig.ref !== listKey) continue
      if (`from_${sourceKey}_${fieldName}` === key) return sourceKey
    }
  }
  return undefined
}

/**
 * Refuse a decoded `where` that filters through a relation into a list MCP
 * does not expose, with the message an unknown key gets (ADR-0053).
 */
export function assertWhereReachable(
  where: Record<string, unknown>,
  config: OpenSaasConfig,
  listKey: string,
  reachable: ReadonlySet<string>,
): void {
  for (const [key, value] of Object.entries(where)) {
    if (LOGICAL_OPERATORS.has(key)) {
      const branches = Array.isArray(value) ? value : [value]
      for (const branch of branches) {
        if (isPlainObject(branch)) assertWhereReachable(branch, config, listKey, reachable)
      }
      continue
    }

    if (!isPlainObject(value)) continue
    const target = relationTarget(config, listKey, key)
    if (target === undefined) continue
    if (!reachable.has(target)) throw unqueryableKey(listKey, key)

    for (const quantifier of RELATION_QUANTIFIERS) {
      const nested = value[quantifier]
      if (isPlainObject(nested)) assertWhereReachable(nested, config, target, reachable)
    }
  }
}
