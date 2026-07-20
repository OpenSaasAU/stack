/**
 * Filter engine types (ADR-0017).
 *
 * The admin UI's Filter builder turns a URL query string into scoped,
 * server-executed filtering. The grammar is an AND-only URL contract:
 * implicit-AND tokens, quoted multi-word values, comparison operators on
 * numeric/date fields, and bare words as free text. Fields participate by
 * declaring a {@link FilterSpec} (a self-contained field-builder method, peer
 * of `getPrismaType` et al.); a field without one is not filterable.
 *
 * These types are the pure boundary — no Prisma / DB imports — so the
 * `parse → tokens` and `tokens + specs → conditions` seam is unit-testable.
 */

/**
 * A Filter operator. `eq` is the default operator for a plain `field:value`
 * token (each field's spec decides what equality means — `contains` for text,
 * `equals` for a select); the comparisons are produced by the `>`/`>=`/`<`/`<=`
 * prefixes on numeric and date tokens.
 */
export type FilterOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte'

/**
 * One parsed unit of a filter query — a field, an operator, and a value.
 *
 * A bare free-text word parses to a token with `field: null`. `raw` is the
 * original source substring, retained so a token that can't map to a condition
 * degrades to free text without re-tokenising.
 */
export interface FilterToken {
  /** Field key the token targets, or `null` for a bare free-text word. */
  field: string | null
  /** The operator; `eq` for a plain `field:value`, comparisons for prefixed values. */
  operator: FilterOperator
  /** The unquoted value. */
  value: string
  /** The original source substring for this token (used when degrading to free text). */
  raw: string
}

/**
 * A Prisma `where` fragment produced by a Filter spec's `toCondition` mapper.
 * Kept as an opaque record so this module carries no Prisma type dependency;
 * the secured context ANDs it with the access filter when the fragment reaches
 * `context.db.*`.
 */
export type FilterCondition = Record<string, unknown>

/**
 * Serializable description of what the suggestion dropdown may offer for a
 * field's values. Structure only — never data-derived values for unbounded
 * fields (ADR-0017): `none` for text/number/date, enumerated `options` for
 * select/checkbox, and `relationship` for label search via the existing
 * access-controlled lookup.
 */
export type FilterValueSource =
  | { kind: 'none' }
  | { kind: 'enum'; options: Array<{ value: string; label: string }> }
  | { kind: 'relationship'; listKey: string; many: boolean }

/**
 * Marker key a to-many relationship's Filter spec emits for a count comparison
 * (`orders:>5`). Prisma cannot express a relation-count comparison in a `where`
 * (there is no `{ orders: { _count: { gt: 5 } } }`), so the pure spec can only
 * emit a structured marker; `resolveRelationshipCountFilters` later turns each
 * marker into an access-scoped `{ id: { in | notIn } }` before the query runs.
 * Kept here (the pure boundary) so the field builder and the resolver agree on
 * the shape without depending on each other.
 */
export const RELATIONSHIP_COUNT_FILTER_KEY = '_countFilter' as const

/**
 * The payload a {@link RELATIONSHIP_COUNT_FILTER_KEY} marker carries: the
 * numeric comparison to apply to a to-many relationship's access-visible count.
 */
export interface RelationshipCountFilterMarker {
  operator: FilterOperator
  value: number
}

/**
 * A field's self-declared filtering capability. Returned by the optional
 * `getFilterSpec` field-builder method.
 */
export interface FilterSpec {
  /** Operators this field supports. A token using any other operator degrades to free text. */
  operators: FilterOperator[]
  /**
   * Whether this field participates in bare-word free-text search. Bare words
   * are OR-matched across every free-text field via each field's `eq` mapping.
   */
  freeText?: boolean
  /**
   * Pure map from a supported `(operator, value)` to a Prisma `where` fragment,
   * or `null` when the value can't be interpreted (e.g. a non-numeric value on
   * a numeric field, or an unknown select option) — in which case the token
   * degrades to free text. MUST stay free of DB/Prisma imports.
   */
  toCondition: (operator: FilterOperator, value: string) => FilterCondition | null
  /** Serializable suggestion metadata for the client. */
  suggestions: {
    valueSource: FilterValueSource
  }
}

/**
 * Collected, client-serializable suggestion metadata for one filterable field.
 * The union of every list field's Filter spec suggestions; carries no
 * functions, so it crosses the server/client boundary.
 */
export interface FilterFieldSuggestion {
  /** The field key. */
  field: string
  /** Operators the field supports. */
  operators: FilterOperator[]
  /** Whether the field participates in bare-word free-text search. */
  freeText: boolean
  /** How the suggestion dropdown may offer values for this field. */
  valueSource: FilterValueSource
}
