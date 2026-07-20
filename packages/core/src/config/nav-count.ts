import type { AccessContext } from '../access/types.js'
import { getDbKey } from '../lib/case-utils.js'
import type { ListConfig, OpenSaasConfig, TypeInfo } from './types.js'

/**
 * The minimal shape a `context.db[list]` delegate needs for a nav count. The
 * access-controlled DB carries an `any` index signature, so this narrows the
 * lookup to just the access-scoped `count` we call.
 */
type CountDelegate = {
  count?: (args?: { where?: unknown }) => Promise<number>
}

/**
 * Whether a list's query access is **statically denied** — provably no session
 * can read any row without evaluating a session-dependent function.
 *
 * Mirrors the list view's `canDeleteList` static check (issue #733): query
 * access is statically denied when it is absent (deny-by-default, matching the
 * access engine) or the literal boolean `false`. A function — or `true` —
 * cannot be decided up front, so the count is fetched through the secured
 * context, which re-applies the real rule per row.
 *
 * A statically-denied list must render no nav count at all: a `0` there would
 * imply "this list is empty" when the truth is "you may see none of it".
 */
export function isListQueryStaticallyDenied(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
): boolean {
  const queryAccess = listConfig.access?.operation?.query
  if (queryAccess === undefined) return true
  if (typeof queryAccess === 'boolean') return !queryAccess
  return false
}

/**
 * Resolve the access-scoped nav counts for the lists that opt in via
 * `ui.navCount` (issue #735).
 *
 * The returned map is keyed by list key and contains an entry **only** for a
 * list that:
 *
 * 1. opts in (`ui.navCount === true`) — no count query runs for any other list,
 * 2. is not a singleton (a single-record list has no meaningful count), and
 * 3. does not have statically-denied query access (see
 *    {@link isListQueryStaticallyDenied}).
 *
 * Each count is read through the secured `context.db`, whose `count` applies the
 * access filter, so the number reflects exactly what the current session may
 * see (a denied row is not counted). Counts are fetched concurrently.
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
    if (listConfig.isSingleton) return false
    return !isListQueryStaticallyDenied(listConfig)
  })

  await Promise.all(
    optedIn.map(async (listKey) => {
      const delegate: CountDelegate | undefined = context.db?.[getDbKey(listKey)]
      if (!delegate?.count) return
      // A single list's count failing (a DB hiccup, a throwing access filter or
      // hook) must not blank the whole admin chrome — `AdminUI` awaits this
      // before rendering the shell. Degrade like the sibling `ListView`: log and
      // omit just that badge. Other lists' counts are unaffected.
      try {
        counts[listKey] = await delegate.count()
      } catch (error) {
        console.error(`Failed to resolve nav count for ${listKey}:`, error)
      }
    }),
  )

  return counts
}
