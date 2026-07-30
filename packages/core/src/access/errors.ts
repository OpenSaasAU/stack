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
