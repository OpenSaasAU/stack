import type {
  AccessContext,
  FieldAccess,
  FieldConfig,
  OperationAccess,
  Session,
} from '@opensaas/stack-core'
import { checkFieldAccess } from '@opensaas/stack-core/internal'
import { FIELD_WRITE_DENIED_REASON, type SerializableFieldConfig } from './serializeFieldConfig.js'

export type OperationAccessName = 'query' | 'create' | 'update' | 'delete'

/**
 * Evaluate a list's operation-level access control for the current session,
 * coercing the result to a single "is this operation potentially permitted?"
 * boolean.
 *
 * This mirrors how the core access engine treats a result:
 * - `false`            → denied
 * - `true`             → permitted
 * - a filter object    → permitted, but scoped to matching rows
 *
 * Because the UI cannot know whether a returned filter would match the
 * (possibly not-yet-created) singleton row, a filter is treated as "potentially
 * permitted" — the actual operation still runs through the access engine, which
 * re-applies the filter. This helper only decides which affordance to render.
 *
 * Access functions are user-defined and may throw. A throw is treated as
 * **denied** — the safest outcome, so a misbehaving access function never
 * exposes an editable/create form to a session that might not be allowed.
 */
export async function isOperationPotentiallyAllowed(
  access: OperationAccess | undefined,
  operation: OperationAccessName,
  args: { session: Session | null; context: AccessContext },
): Promise<boolean> {
  const accessControl = access?.[operation]
  // Deny by default — no rule means no access (matches the core engine).
  if (!accessControl) return false

  try {
    const result = await accessControl({
      session: args.session,
      context: args.context,
    })
    // `false` denies; `true` or a filter object both mean "potentially allowed".
    return result !== false
  } catch {
    // A throwing access function is treated as denied — never widen access on error.
    return false
  }
}

/**
 * Decide whether a field may show an editable affordance for a given write
 * operation — a Relationship-table cell's inline edit (#737) or an item
 * form's control (#1402) — evaluating the field's CREATE/UPDATE-time
 * field-level access.
 *
 * Delegates to the core engine's canonical `checkFieldAccess` (the single
 * field-access evaluator — the UI never re-implements it). A field with no
 * access rule for `operation` is writable (matches the engine's
 * allow-by-default); a rule that returns `false` for this session is NOT
 * writable, so the caller renders it read-only with no affordance.
 *
 * Only a STATIC deny hides the affordance. Field access that depends on
 * `item` (omitted by a caller deciding per column rather than per row, or
 * simply not yet known) throws when it dereferences the missing item — that
 * is treated as "potentially writable" so the affordance shows and any
 * row-level (filter-scoped) denial surfaces at commit as a revert/refusal,
 * never a denied-vs-absent leak.
 */
export async function isFieldPotentiallyWritable(
  fieldAccess: FieldAccess | undefined,
  operation: 'create' | 'update',
  args: { session: Session | null; context: AccessContext; item?: Record<string, unknown> },
): Promise<boolean> {
  try {
    return await checkFieldAccess(fieldAccess, operation, {
      session: args.session,
      context: args.context,
      item: args.item,
    })
  } catch {
    // Item-dependent field access can't be decided statically — keep the
    // affordance; the secured commit re-checks per row and reverts on denial.
    return true
  }
}

/**
 * Mark every field whose CREATE/UPDATE field-level access denies this session
 * read-only, so an item form renders it as a display value instead of an
 * editable control it would then have to discard (issue #1402).
 *
 * Without this, a form built from the raw field configs collects a value for
 * a field like `embedding()`'s (`access: { create: () => false, update: () =>
 * false }` by default) and resubmits it on every save, which the write
 * pipeline refuses WHOLE — `Cannot update "x": field-level access denied.` —
 * leaving even the fields the session COULD write unsaved.
 *
 * Runs after `markUnwritableRelationships` and `markToManyEdgeWrites`: a field
 * already read-only for one of those reasons keeps it, and a to-many carrying
 * an edge plan is written against the RELATED list (ADR-0050) rather than in
 * this payload, so this field's own access is not what gates it.
 *
 * Each field's access rule is checked concurrently (`Promise.all`), matching
 * the per-field relationship fetch in `prepareItemForm` — a rule is
 * user-defined and may itself do async work, so a list with many fields would
 * otherwise pay that latency serially on every render.
 *
 * Mutates `serializableFields` in place.
 */
export async function markWriteDeniedFields(
  serializableFields: Record<string, SerializableFieldConfig>,
  fields: Record<string, FieldConfig>,
  operation: 'create' | 'update',
  args: { session: Session | null; context: AccessContext; item?: Record<string, unknown> },
): Promise<void> {
  await Promise.all(
    Object.entries(fields).map(async ([fieldName, fieldConfig]) => {
      const serialized = serializableFields[fieldName]
      if (!serialized || serialized.readOnly || serialized.virtual || serialized.edgeWrite) return

      const writable = await isFieldPotentiallyWritable(fieldConfig.access, operation, args)
      if (!writable) {
        serialized.readOnly = true
        serialized.readOnlyReason = FIELD_WRITE_DENIED_REASON
      }
    }),
  )
}
