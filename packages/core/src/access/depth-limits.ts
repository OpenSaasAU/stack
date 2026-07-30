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
