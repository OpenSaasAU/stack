/**
 * Maximum nesting depth of relation `include`s the Access Filter
 * (`buildAccessScopedInclude`) will scope on a read.
 *
 * Since ADR-0026 made the read pipeline caller-directed, this is a COST
 * limit, not an access-control boundary: nothing walks the relationship
 * graph unprompted anymore, so there is no unscoped tree to fail open on. A
 * request naming a relation at or beyond this depth still throws
 * `AccessScopeDepthExceededError` (ADR-0022, issue #830) — the engine
 * declines to serve a tree this expensive, not because it cannot scope one.
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
