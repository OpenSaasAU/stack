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
