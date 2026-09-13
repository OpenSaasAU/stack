import type { AccessContext, OrmRow } from '../access/types.js'
import {
  firstMatching,
  identityPredicate,
  whereCombinators,
  writeCollection,
} from '../secured/write.js'

/**
 * Thrown when {@link readPluginOwnedRow} is handed a context carrying no ORM
 * handle — the read-side twin of `writePluginOwnedField`'s
 * `HandlelessPluginFieldWriteError`.
 */
export class HandlelessPluginFieldReadError extends Error {
  constructor(readonly listName: string) {
    super(
      `Refused to read "${listName}": the context carries no ORM handle. Pass the AccessContext ` +
        `Plugin.runtime receives as its first argument, not the StackContext getContext returns ` +
        `— the returned context omits the handle on purpose.`,
    )
    this.name = 'HandlelessPluginFieldReadError'
  }
}

export interface PluginOwnedRowRead {
  /** The `AccessContext` core hands `Plugin.runtime` as its first argument. */
  context: AccessContext
  listName: string
  id: string | number
}

/**
 * Reads one row by id, past every access-control layer — including Field
 * Visibility, since a plugin reaching for this generally needs the row as
 * persisted, not this session's projection of it (a read-restricted column a
 * plugin's own regeneration check depends on, say — see #1282).
 *
 * The read-side twin of `writePluginOwnedField` (ADR-0068): both are a
 * plugin's escalated access to a row, over the same engine-owned target-read
 * machinery a write's own pre-transaction gate uses (`firstMatching` /
 * `identityPredicate` in `secured/write.ts`) rather than a second copy of it
 * in every plugin that needs to see its own row. Marked `withOrigin('engine')`
 * the same way, through `firstMatching`.
 *
 * Returns `null` when the row is gone, matching every other engine read.
 */
export async function readPluginOwnedRow(args: PluginOwnedRowRead): Promise<OrmRow | null> {
  const { context, listName, id } = args

  if (context.ormHandle === undefined) {
    throw new HandlelessPluginFieldReadError(listName)
  }

  const ops = await whereCombinators()
  const collection = writeCollection(context.ormHandle, listName)
  return await firstMatching(collection, [identityPredicate(listName, id)], ops)
}
