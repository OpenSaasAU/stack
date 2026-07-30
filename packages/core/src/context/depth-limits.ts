/**
 * Maximum nesting depth of relationship writes walked by the Write Pipeline's
 * nested-operations processing (`processNestedOperations`) and mirrored by the
 * transaction-boundary involved-list walk (`walkNested`), which must see the
 * same payload shape to fire the correct per-list hook brackets.
 *
 * This bounds worst-case work for a single write payload. Unlike
 * `READ_INCLUDE_MAX_DEPTH`, it is a cost bound, not an access-control
 * boundary — the payload past this depth is left unprocessed, not scoped, so
 * this constant is deliberately kept separate rather than shared with the
 * read-side limit. See issue #835 for the tracked write-path gap.
 */
export const NESTED_WRITE_MAX_DEPTH = 5
