import type { AccessContext } from '../access/types.js'
import type { FieldConfig } from '../config/types.js'
import {
  identityPredicate,
  updateFirst,
  whereCombinators,
  writeCollection,
} from '../secured/write.js'

/**
 * Thrown when {@link writePluginOwnedField} is handed a context carrying no
 * ORM handle. The request context `getContext` returns is one: `StackContext`
 * deliberately omits `ormHandle`, so passing it — or the `sudo()` derived from
 * it — reaches here instead of failing as an undefined property deep in the
 * write.
 */
export class HandlelessPluginFieldWriteError extends Error {
  constructor(
    readonly listName: string,
    readonly fieldName: string,
  ) {
    super(
      `Refused to write "${listName}.${fieldName}": the context carries no ORM handle. Pass ` +
        `the AccessContext Plugin.runtime receives as its first argument, not the StackContext ` +
        `getContext returns — the returned context omits the handle on purpose.`,
    )
    this.name = 'HandlelessPluginFieldWriteError'
  }
}

/** Everything this write reads off the field's config: how it lays out its columns. */
export type OwnedFieldLayout = Pick<FieldConfig, 'splitColumns'>

export interface PluginOwnedFieldWrite {
  /** The `AccessContext` core hands `Plugin.runtime` as its first argument. */
  context: AccessContext
  listName: string
  id: string | number
  fieldName: string
  /** The field the plugin owns, for its column layout. */
  fieldConfig: OwnedFieldLayout
  /** The field's logical value, or `null` to clear it. */
  value: unknown
}

/**
 * Write one plugin-owned field's columns on one row, running no hook.
 *
 * A field a plugin computes is write-denied to application code (ADR-0045),
 * so the plugin's own output reaches the column through an escalated write.
 * That write is not an application update: it carries the plugin's column and
 * nothing else, and it completes a write the application already made, whose
 * hooks have already run against the caller's real input.
 *
 * Driving it through `sudo().db.<list>.update()` therefore runs the list's
 * hooks a second time over a payload naming only this field — which destroys
 * data. A list-level `resolveInput` deriving one field from others (the
 * pattern the root `CLAUDE.md` documents) recomputes the derived field from
 * absent inputs and overwrites the persisted value; `validate` sees a record
 * that is mostly missing; `beforeOperation`/`afterOperation` fire a second
 * time for a single logical change; and the plugin's own generation hook
 * re-enters itself. This write runs none of them.
 *
 * What it keeps is the field's own column contract: a multi-column field is
 * split by its `splitColumns` exactly as the Write Pipeline splits it, so a
 * plugin never names a physical column itself.
 *
 * It reaches no other field. The payload is this field's columns and nothing
 * else, which is a narrower capability than the escalated `db` update it
 * replaces — that one could write any column on the row.
 *
 * The row is addressed by id alone, with no Access Filter beside it. A row
 * that is gone is a silent no-op, as it is on every write terminal.
 */
export async function writePluginOwnedField(args: PluginOwnedFieldWrite): Promise<void> {
  const { context, listName, id, fieldName, fieldConfig, value } = args

  if (context.ormHandle === undefined) {
    throw new HandlelessPluginFieldWriteError(listName, fieldName)
  }

  const columns = fieldConfig.splitColumns
    ? fieldConfig.splitColumns(fieldName, value)
    : { [fieldName]: value }

  const ops = await whereCombinators()

  await updateFirst(
    writeCollection(context.ormHandle, listName),
    [identityPredicate(listName, id)],
    ops,
    columns,
  )
}
