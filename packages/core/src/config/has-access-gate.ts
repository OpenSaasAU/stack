import type { AccessContext, Session } from '../access/types.js'

export interface AccessGated {
  key: string
  hasAccess?: (args: {
    session: Session | null
    context: AccessContext
    listKey: string
  }) => boolean | Promise<boolean>
}

/**
 * Run one `ui.listView` entry's `hasAccess` gate for this session. Only a
 * literal `true` opens it; a throw is logged and counts as denied.
 */
export async function checkHasAccess(
  gated: AccessGated,
  context: AccessContext,
  listKey: string,
  noun: string,
): Promise<boolean> {
  if (!gated.hasAccess) return true
  try {
    return (await gated.hasAccess({ session: context.session, context, listKey })) === true
  } catch (error) {
    console.error(`${noun} "${gated.key}" on "${listKey}" hasAccess threw:`, error)
    return false
  }
}

/**
 * The entries whose `hasAccess` gate opens for this session, in declaration
 * order, with every gate run concurrently through {@link checkHasAccess}.
 */
export async function filterByHasAccess<TGated extends AccessGated>(
  entries: readonly TGated[] | undefined,
  context: AccessContext,
  listKey: string,
  noun: string,
): Promise<TGated[]> {
  if (!entries || entries.length === 0) return []
  const allowed = await Promise.all(
    entries.map((entry) => checkHasAccess(entry, context, listKey, noun)),
  )
  return entries.filter((_, index) => allowed[index])
}
