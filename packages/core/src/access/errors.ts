import { READ_INCLUDE_MAX_DEPTH } from './depth-limits.js'

/**
 * Thrown when a caller-supplied `include` names a relation nested deeper than
 * `READ_INCLUDE_MAX_DEPTH`. Deliberately distinct from `ValidationError`: this
 * is not bad user input, it is the engine declining to serve a tree this
 * expensive. Code that catches `ValidationError` to report form errors must
 * not silently swallow this.
 *
 * Only an explicit request naming something at or past the cap triggers this
 * — a read that simply doesn't reach this deep never throws. Before
 * ADR-0026 made the read pipeline caller-directed, this cap was the engine's
 * last line of defense against returning a relation it could not prove was
 * row/field scoped (ADR-0022, issue #830); a request naming anything at this
 * depth is now scoped exactly like every other named relation; the cap
 * exists solely to bound how deep a request may cost the engine to serve. See
 * ADR-0026 and `docs/adr/0022-access-control-fails-closed-when-it-cannot-scope.md`.
 */
export class AccessScopeDepthExceededError extends Error {
  public listKey: string
  public fieldKey: string
  public depth: number

  constructor(listKey: string, fieldKey: string, depth: number) {
    super(
      `Cannot include "${listKey}.${fieldKey}" at include depth ${depth}: this exceeds the read ` +
        `pipeline's maximum include depth (${READ_INCLUDE_MAX_DEPTH}). This is a cost limit, not an ` +
        `inability to scope — the engine declines to serve a tree this deep rather than returning ` +
        `it. Restructure the query to fetch this relation separately.`,
    )
    this.name = 'AccessScopeDepthExceededError'
    this.listKey = listKey
    this.fieldKey = fieldKey
    this.depth = depth
  }
}

/**
 * Thrown when a `resolveOutput` hook re-enters a `(list, field)` pair already
 * on its own resolve chain — a hook whose own read (directly or transitively)
 * comes back around to itself. Deliberately distinct from `ValidationError`
 * (same reasoning as `AccessScopeDepthExceededError`): this is not bad user
 * input, it is the engine refusing to run a hook chain that cannot terminate.
 *
 * This is a loud failure, not a Silent one, on purpose: a repeated pair never
 * terminated before this guard existed, so no working application can depend
 * on the old (hanging) behaviour, and staying silent here would return
 * `undefined` for a field with nothing in the logs to explain why. Contrast
 * with exceeding `RESOLVE_CHAIN_MAX_LENGTH`, which can happen on a chain that
 * would otherwise terminate correctly and therefore only warns. See ADR-0023.
 */
export class ResolveOutputCycleError extends Error {
  public chain: readonly { listKey: string; fieldKey: string }[]

  constructor(chain: readonly { listKey: string; fieldKey: string }[]) {
    const path = chain.map((link) => `${link.listKey}.${link.fieldKey}`).join(' → ')
    super(
      `resolveOutput cycle detected: ${path}. A hook that re-enters a (list, field) pair ` +
        `already on its own resolve chain cannot terminate, so the read is refused rather than ` +
        `left to recurse until the process runs out of memory. Restructure the hooks so the read ` +
        `does not loop back into itself.`,
    )
    this.name = 'ResolveOutputCycleError'
    this.chain = chain
  }
}

/**
 * Thrown when a relation filter in a caller's `where` (`some`/`every`/`none`/
 * `is`/`isNot`) names a relationship whose related list denies operation-level
 * `query` access outright (`=== false`). Deliberately a loud failure, not a
 * silently narrowed `{ id: { in: [] } }` or a pass-through: ADR-0022 requires
 * an engine that cannot compute a scope to deny, never pass through, and here
 * the engine CAN compute the scope (denied) — passing that through as a
 * silently-empty match would itself be a distinguishable signal for a caller
 * probing which relations they may filter on. `include`'s equivalent case
 * (`buildAccessScopedInclude`) drops the relation silently instead, because a
 * `null`/missing key in a response is indistinguishable from "not requested";
 * a `where` predicate has no such neutral outcome, so a relation filter on a
 * fully denied relation is refused instead. `sudo` bypasses this check
 * entirely, matching every other access-control escape hatch. See #916 and
 * `docs/adr/0022-access-control-fails-closed-when-it-cannot-scope.md`.
 */
export class RelationFilterAccessDeniedError extends Error {
  public listKey: string
  public fieldKey: string
  public relatedListKey: string

  constructor(listKey: string, fieldKey: string, relatedListKey: string) {
    super(
      `Cannot filter "${listKey}.${fieldKey}" — the related list "${relatedListKey}" denies ` +
        `query access to this session, so this relation filter cannot be scoped. Denial is loud ` +
        `rather than silently narrowed to match nothing (ADR-0022). Use sudo to bypass.`,
    )
    this.name = 'RelationFilterAccessDeniedError'
    this.listKey = listKey
    this.fieldKey = fieldKey
    this.relatedListKey = relatedListKey
  }
}

function describeAccessResult(result: unknown): string {
  if (result === null) return 'null'
  if (result === undefined) return 'undefined'
  if (typeof result === 'object') return 'an object (e.g. a Prisma filter)'
  return `a ${typeof result}`
}

/**
 * Thrown when a field-level access control function returns anything other
 * than a strict `boolean`. `FieldAccessControl` is typed to return `boolean`
 * only: field access is a single per-field visibility decision, not a row
 * filter, and a denied field is removed rather than used to scope rows (see
 * the "Field-level access" glossary entry in `CONTEXT.md`, ADR-0001, and
 * ADR-0030).
 *
 * A rule that type-checks can never reach this — the only way here is a
 * caller that bypasses the type (an untyped JS config, or a value forced past
 * the checker), most notably a Prisma filter, which is the shape
 * operation-level `AccessControl` accepts but `FieldAccessControl` does not.
 * Before #913 this fell through to an unconditional `return true`, silently
 * granting the field blanket access; it now fails loudly and closed instead,
 * for `read`, `create`, and `update` alike.
 *
 * Deliberately does not expose the offending result as a public field: unlike
 * `AccessScopeDepthExceededError`/`ResolveOutputCycleError`'s fields, there is
 * no concretely-typed shape to give it (the whole problem is that it isn't
 * the `boolean` the caller's rule promised), and the root CLAUDE.md forbids
 * exposing `unknown`/`any` as part of a package's external API. A description
 * of what was returned instead is folded into the message text.
 */
export class InvalidFieldAccessResultError extends Error {
  public operation: 'read' | 'create' | 'update'

  constructor(operation: 'read' | 'create' | 'update', result: unknown) {
    super(
      `Field-level access control for operation "${operation}" returned ` +
        `${describeAccessResult(result)}, not a boolean. Field access is a per-field ` +
        `visibility decision — it must return true or false, and (unlike operation-level access) ` +
        `cannot scope which rows are affected. If you meant to restrict access based on the row or ` +
        `the write payload, evaluate the condition yourself and return a boolean, e.g. ` +
        `\`({ item, session }) => item?.ownerId === session?.userId\`.`,
    )
    this.name = 'InvalidFieldAccessResultError'
    this.operation = operation
  }
}

/**
 * Thrown when operation-level `create` access control returns anything other
 * than a strict `boolean`. `OperationAccess['create']` is typed as
 * `AccessControl`, which also accepts a `PrismaFilter` — the shape
 * `query`/`update`/`delete` legitimately use to scope which rows an
 * operation may touch (see ADR-0001). Create has none of that to scope: there
 * is no existing row, and — unlike update/delete, which re-check a returned
 * filter against the target via `findFirst` — no equivalent re-check is
 * possible against data that doesn't exist in the database yet.
 *
 * A filter-returning `create` rule type-checks (the shared `AccessControl`
 * type admits it) and reads as though it scopes the create. Before this it
 * fell through a check that only tested `=== false` and was silently treated
 * as a full allow. This is the same defect shape ADR-0030 closed for
 * field-level access, resolved the same way per ADR-0022 (an engine that
 * cannot compute a scope must deny, never pass through) — a loud, distinct
 * failure rather than a wider `null`/`[]` Silent failure, because this is a
 * config bug, not an access denial.
 *
 * Deliberately does not expose the offending result as a public field, for
 * the same reason as `InvalidFieldAccessResultError`: there is no
 * concretely-typed shape to give it, and the root CLAUDE.md forbids exposing
 * `unknown`/`any` as part of a package's external API.
 */
export class InvalidCreateAccessResultError extends Error {
  public listKey: string

  constructor(listKey: string, result: unknown) {
    super(
      `Operation-level "create" access control for "${listKey}" returned ` +
        `${describeAccessResult(result)}, not a boolean. Create cannot be row-scoped — there is no ` +
        `existing row, and no input data is available to test a filter against here. Return a ` +
        `boolean from create access, or move the ownership check into a \`resolveInput\` or ` +
        `\`validate\` hook, where the input data is in scope.`,
    )
    this.name = 'InvalidCreateAccessResultError'
    this.listKey = listKey
  }
}
