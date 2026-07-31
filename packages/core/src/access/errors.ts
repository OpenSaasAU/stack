import { READ_INCLUDE_MAX_DEPTH } from './depth-limits.js'

/**
 * Thrown when a caller-supplied `include` names a relation nested deeper than
 * the Access Filter can scope (see `READ_INCLUDE_MAX_DEPTH`). Deliberately
 * distinct from `ValidationError`: this is not bad user input, it is the
 * engine refusing to return data it cannot prove is row/field scoped. Code
 * that catches `ValidationError` to report form errors must not silently
 * swallow this.
 *
 * Only an explicit caller selection past the depth cap triggers this — the
 * auto-include silently stopping at the cap (no caller `include` involved)
 * never throws. See ADR-0022 and issue #830.
 */
export class AccessScopeDepthExceededError extends Error {
  public listKey: string
  public fieldKey: string
  public depth: number

  constructor(listKey: string, fieldKey: string, depth: number) {
    super(
      `Cannot compute an access scope for "${listKey}.${fieldKey}" at include depth ${depth}: ` +
        `this exceeds the Access Filter's maximum read-include depth (${READ_INCLUDE_MAX_DEPTH}). ` +
        `A caller-supplied include this deep cannot be row- and field-scoped, so the read is denied ` +
        `rather than returned unscoped. Restructure the query to fetch this relation separately.`,
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
