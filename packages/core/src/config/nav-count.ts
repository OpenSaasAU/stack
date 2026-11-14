import type { AccessContext } from '../access/types.js'
import type { AggregateBuild } from '../secured/aggregate.js'
import type { ListConfig, OpenSaasConfig, TypeInfo } from './types.js'

/**
 * The minimal shape a `context.db[list]` delegate needs for a nav count. The
 * access-controlled DB carries an `any` index signature, so this narrows the
 * lookup to just the access-scoped reducer we call.
 */
type CountDelegate = {
  aggregate?: (build: AggregateBuild) => Promise<Record<string, number>>
}

/**
 * Resolve the access-scoped nav counts for lists that opt in via
 * `ui.navCount` (issue #735). A list gets an entry only if it opts in, isn't
 * a singleton, and its Session vocabulary does not deny `query` (ADR-0084) —
 * everything else is omitted from the map, never zeroed. A context that
 * resolves no vocabulary for a list counts it as denied.
 *
 * Each count is read through the secured `context.db`, so it reflects
 * exactly what the current session may see.
 */
export async function resolveNavCounts(
  context: AccessContext,
  config: OpenSaasConfig,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  const lists = config.lists ?? {}

  const optedIn = Object.keys(lists).filter((listKey) => {
    const listConfig = lists[listKey] as ListConfig<TypeInfo> | undefined
    if (!listConfig) return false
    if (listConfig.ui?.navCount !== true) return false
    return !listConfig.isSingleton
  })

  await Promise.all(
    optedIn.map(async (listKey) => {
      const vocabulary = (await context._sessionVocabulary?.(listKey)) ?? null
      if (vocabulary === null || vocabulary.operations.query === 'deny') return
      const delegate: CountDelegate | undefined = context.db?.[listKey]
      if (!delegate?.aggregate) return
      // A single list's count failing (a DB hiccup, a throwing access filter or
      // hook) must not blank the whole admin chrome — `AdminUI` awaits this
      // before rendering the shell. Degrade like the sibling `ListView`: log and
      // omit just that badge. Other lists' counts are unaffected.
      try {
        const reduced = await delegate.aggregate((aggregate) => ({ total: aggregate.count() }))
        counts[listKey] = reduced.total
      } catch (error) {
        console.error(`Failed to resolve nav count for ${listKey}:`, error)
      }
    }),
  )

  return counts
}
