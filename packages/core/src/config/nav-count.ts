import type { AccessContext } from '../access/types.js'
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
 * can read any row, without evaluating a session-dependent function.
 *
 * Mirrors the list view's `canDeleteList` static check (issue #733): absent
 * access is deny-by-default (matching the access engine), so only an explicit
 * `false` counts as statically denied here — a function or `true` falls
 * through to a real per-row check via the secured context.
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
 * Resolve the access-scoped nav counts for lists that opt in via
 * `ui.navCount` (issue #735). A list gets an entry only if it opts in, isn't
 * a singleton (no meaningful count), and isn't {@link isListQueryStaticallyDenied}
 * — everything else is omitted from the map, never zeroed.
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
    if (listConfig.isSingleton) return false
    return !isListQueryStaticallyDenied(listConfig)
  })

  await Promise.all(
    optedIn.map(async (listKey) => {
      const delegate: CountDelegate | undefined = context.db?.[listKey]
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
