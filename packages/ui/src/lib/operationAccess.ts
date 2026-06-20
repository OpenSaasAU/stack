import type { AccessContext, OperationAccess, Session } from '@opensaas/stack-core'

/**
 * The names of the operation-level access checks we evaluate in the UI.
 */
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
 * Access functions are user-defined and may throw (e.g. they assume a session
 * shape that anonymous requests don't have). A throw is treated as **denied** —
 * the safest outcome, so a misbehaving access function never exposes an
 * editable/create form to a session that might not be allowed.
 *
 * No access function configured for the operation is also treated as denied,
 * matching the core engine's deny-by-default (`checkAccess` returns `false`
 * when `accessControl` is undefined).
 */
export async function isOperationPotentiallyAllowed(
  access: OperationAccess | undefined,
  operation: OperationAccessName,
  args: { session: Session | null; context: AccessContext<unknown> },
): Promise<boolean> {
  const accessControl = access?.[operation]
  // Deny by default — no rule means no access (matches the core engine).
  if (!accessControl) return false

  try {
    const result = await accessControl({
      session: args.session,
      // The access engine passes the same context through to the function.
      context: args.context,
    })
    // `false` denies; `true` or a filter object both mean "potentially allowed".
    return result !== false
  } catch {
    // A throwing access function is treated as denied — never widen access on error.
    return false
  }
}
