/**
 * Maximum nesting depth of relation `include`s that the Access Filter
 * (`buildIncludeWithAccessControl`) will auto-scope on a read.
 *
 * Security implication: this is an access-control boundary, not just a cost
 * bound. Past this depth the engine cannot compute a row/field scope for a
 * relation, so a caller-supplied `include` naming a relation at or beyond it
 * must be treated as a denial (see `AccessScopeDepthExceededError`) rather
 * than passed through unscoped — see ADR-0022 and issue #830.
 */
export const READ_INCLUDE_MAX_DEPTH = 5

/**
 * Maximum length of the resolve chain — the ordered sequence of `resolveOutput`
 * hooks a read has entered, each entry extended by a hook that issues its own
 * read (see `_resolveOutputChain` on `AccessContext`).
 *
 * This is a COST limit, not an access-control boundary: an acyclic chain
 * genuinely can exceed it and still be correct (e.g. a virtual `Order.total`
 * reading a virtual `LineItem.subtotal` reading further virtuals), so
 * exceeding it omits the field and emits a single `console.warn` rather than
 * throwing. Termination itself is guaranteed by the separate cycle guard,
 * which refuses to re-enter a `(list, field)` pair already on the chain
 * regardless of this cap. See ADR-0023.
 */
export const RESOLVE_CHAIN_MAX_LENGTH = 5
