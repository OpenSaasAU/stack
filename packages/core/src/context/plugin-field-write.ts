import type { AccessContext } from '../access/types.js'
import { resolveListMember, type DeclaredFieldMember } from '../members/list-members.js'
import {
  columnEqualsPredicate,
  identityPredicate,
  updateFirst,
  whereCombinators,
  writeCollection,
} from '../secured/write.js'

/**
 * Thrown when {@link writePluginOwnedField} is handed a context carrying no
 * ORM handle. The request context `getContext` returns is one: `StackContext`
 * deliberately omits `ormHandle`, so passing it reaches here instead of
 * failing as an undefined property deep in the write.
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

/**
 * Thrown when {@link writePluginOwnedField} cannot resolve the named field
 * against the config its context was built from — which is the only authority
 * for what columns the write may reach.
 */
export class UnknownPluginFieldWriteError extends Error {
  constructor(
    readonly listName: string,
    readonly fieldName: string,
    readonly reason: string,
  ) {
    super(
      `Refused to write "${listName}.${fieldName}": ${reason}. The field's column layout is ` +
        `read off the config the context was built from, never off an argument, so a field the ` +
        `config does not declare has no columns this write is allowed to reach.`,
    )
    this.name = 'UnknownPluginFieldWriteError'
  }
}

/**
 * Thrown when {@link writePluginOwnedField} is handed a virtual field. It is
 * declared, so the list/field lookups both succeed, but it owns no column:
 * nothing in the config's column layout names a place for this write to
 * land. Left unrefused, the write falls through to `splitColumns`'s fallback
 * (`{ [fieldName]: value }`) and reaches the ORM naming a column that does
 * not exist, which the database rejects with its own error type — one the
 * RAG plugin's failure classifier does not recognise as a refusal, so it
 * reports the failure as transient and retries a write that can never
 * succeed.
 */
export class NoColumnsPluginFieldWriteError extends Error {
  constructor(
    readonly listName: string,
    readonly fieldName: string,
    kind: 'virtual' | 'relationship' = 'virtual',
  ) {
    super(
      kind === 'relationship'
        ? `Refused to write "${listName}.${fieldName}": relationship fields are not writable ` +
            `here. writePluginOwnedField stores a value into the field's own scalar columns, and ` +
            `a relationship is an edge, not a column.`
        : `Refused to write "${listName}.${fieldName}": this field is virtual and has no columns ` +
            `to write to. writePluginOwnedField stores a value into the field's own columns, and a ` +
            `virtual field's contract descriptor is "computed" — it has none.`,
    )
    this.name = 'NoColumnsPluginFieldWriteError'
  }
}

/**
 * Thrown when {@link writePluginOwnedField} is handed `undefined`. It is the
 * one value whose meaning would depend on the field's column layout — a
 * multi-column field would split it into null columns and clear the field, a
 * single-column one would reach the ORM as a no-op — so it is refused instead
 * of resolved. `null` clears a field on either shape.
 */
export class UndefinedPluginFieldWriteError extends Error {
  constructor(
    readonly listName: string,
    readonly fieldName: string,
  ) {
    super(
      `Refused to write "${listName}.${fieldName}": the value is undefined. Pass null to clear ` +
        `the field — undefined would wipe a multi-column field and leave a single-column one ` +
        `untouched, which is two different writes for one input.`,
    )
    this.name = 'UndefinedPluginFieldWriteError'
  }
}

export interface PluginOwnedFieldWrite {
  /** The `AccessContext` core hands `Plugin.runtime` as its first argument. */
  context: AccessContext
  listName: string
  id: string | number
  /** A field the config on `context` declares on `listName`. */
  fieldName: string
  /** The field's logical value, or `null` to clear it. `undefined` is refused. */
  value: unknown
  /** Skip the write unless this scalar field still holds exactly this value. */
  onlyIfUnchanged?: { fieldName: string; value: string | number | boolean | null }
}

function ownedField(
  context: AccessContext,
  listName: string,
  fieldName: string,
): DeclaredFieldMember {
  const refuse = (reason: string): never => {
    throw new UnknownPluginFieldWriteError(listName, fieldName, reason)
  }

  const config = context._config
  if (config === undefined) {
    return refuse('the context carries no config to resolve the field against')
  }

  if (!Object.hasOwn(config.lists, listName)) {
    return refuse(`the config declares no list "${listName}"`)
  }

  const member = resolveListMember(config, listName, fieldName)
  if (member?.kind !== 'field') return refuse(`list "${listName}" declares no field "${fieldName}"`)

  switch (member.storage.kind) {
    case 'computed':
      throw new NoColumnsPluginFieldWriteError(listName, fieldName)
    case 'relation':
      throw new NoColumnsPluginFieldWriteError(listName, fieldName, 'relationship')
    case 'column':
    case 'columns':
      return member
    default: {
      const unhandled: never = member.storage
      return unhandled
    }
  }
}

function guardColumn(context: AccessContext, listName: string, fieldName: string): string {
  if (ownedField(context, listName, fieldName).storage.kind === 'columns') {
    throw new UnknownPluginFieldWriteError(
      listName,
      fieldName,
      'it spans several columns, so it cannot guard a write',
    )
  }
  return fieldName
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
 * It reaches no field but `fieldName`, and that is enforced rather than left
 * to the caller: the field is resolved against the config on `context`, and
 * the columns written are whatever that field's own `splitColumns` returns.
 * A list or a field the config does not declare is refused by name, as is a
 * context carrying no config, and as is a virtual field — one storing
 * nothing, by `virtual`, `type`, or a `{ kind: 'computed' }` contract
 * descriptor. This is a narrower capability than the
 * escalated `db` update it replaces — that one could write any column on the
 * row — though not a privilege boundary: a plugin holding `context.ormHandle`
 * can already write anything, and this refuses the mistake, not the intent.
 *
 * The row is addressed by id alone, with no Access Filter beside it. A row
 * that is gone is a silent no-op, as it is on every write terminal.
 */
export async function writePluginOwnedField(args: PluginOwnedFieldWrite): Promise<void> {
  const { context, listName, id, fieldName, value, onlyIfUnchanged } = args

  if (context.ormHandle === undefined) {
    throw new HandlelessPluginFieldWriteError(listName, fieldName)
  }

  if (value === undefined) {
    throw new UndefinedPluginFieldWriteError(listName, fieldName)
  }

  const { field: fieldConfig } = ownedField(context, listName, fieldName)

  const columns = fieldConfig.splitColumns
    ? fieldConfig.splitColumns(fieldName, value)
    : { [fieldName]: value }

  const ops = await whereCombinators()

  await updateFirst(
    writeCollection(context.ormHandle, listName),
    [
      identityPredicate(listName, id),
      ...(onlyIfUnchanged === undefined
        ? []
        : [
            columnEqualsPredicate(
              listName,
              guardColumn(context, listName, onlyIfUnchanged.fieldName),
              onlyIfUnchanged.value,
            ),
          ]),
    ],
    ops,
    columns,
  )
}
