/**
 * Filter engine types (ADR-0017, ADR-0083). The pure boundary: no Prisma or DB
 * imports, so `parse → query` and `query + specs → condition` are unit-testable.
 */

import type { Where } from '../secured/vocabulary.js'

/**
 * A Filter operator. `eq` is the default operator for a plain `field:value`
 * token (each field's spec decides what equality means — `contains` for text,
 * `equals` for a select); the comparisons are produced by the `>`/`>=`/`<`/`<=`
 * prefixes on numeric and date tokens.
 */
export type FilterOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte'

/**
 * What a token asks of its field: a {@link FilterOperator} on its values, or
 * `empty` for `field:!`, which carries no values and matches the rows where
 * the field has no value.
 */
export type FilterTokenOperator = FilterOperator | 'empty'

/** One value of a {@link FilterToken}, as written. */
export interface FilterValue {
  /** The unquoted, unescaped text. */
  text: string
  /**
   * Whether the value was written in double quotes, which keeps it literal: a
   * quoted `"status:draft"` is a free-text word, never a field token, and a
   * quoted `"!"` is the text `!`, never "is empty".
   */
  quoted: boolean
}

/**
 * One Filter token: a field, an operator and its values.
 *
 * A bare free-text word has `field: null`. `negated` is ADR-0083's
 * `-field:value`, a `values` list longer than one its `field:a,b`, and the
 * `empty` operator its `field:!`.
 */
export interface FilterToken {
  kind: 'token'
  /** Field key the token targets, or `null` for a bare free-text word. */
  field: string | null
  /** `eq` for a plain `field:value`, comparisons for prefixed values, `empty` for `field:!`. */
  operator: FilterTokenOperator
  /** Whether the token is negated (`-field:value`). */
  negated: boolean
  /** The values, in the order written. Empty for the `empty` operator. */
  values: FilterValue[]
}

/**
 * One term of a {@link FilterQuery}'s conjunction. A term is a
 * {@link FilterToken}; ADR-0083's OR group joins this union under its own `kind`.
 */
export type FilterTerm = FilterToken

/**
 * A structured filter query: an AND of {@link FilterTerm}s. Produced by
 * {@link parseFilterQuery} and turned back into the `?search=` grammar by
 * {@link serializeFilterQuery}, its inverse.
 */
export interface FilterQuery {
  terms: FilterTerm[]
}

/**
 * A predicate in the secured surface's Where vocabulary, produced by a Filter
 * spec's `toCondition` mapper (ADR-0055). The vocabulary is data, declared in
 * a module that imports nothing from the ORM, which is what keeps this seam —
 * and the URL grammar built on it — unit-testable.
 *
 * The secured context ANDs it with the Access Filter when it reaches
 * `context.db.<List>.where(...)`, so a filter can only ever narrow.
 */
export type FilterCondition = Where

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

/** One regular expression a typed filter value must match, and how to explain it. */
export interface FilterValuePattern {
  /** A regular expression source the trimmed value must match. */
  pattern: string
  /** What the field takes, read after the field's name: `takes a whole number`. */
  description: string
}

/**
 * The shape a typed value must take for a field's Filter spec to map it,
 * stated as serialisable data so the Filter builder can explain a value that
 * does not fit before it is applied, instead of letting it become free text.
 */
export interface FilterValueFormat extends FilterValuePattern {
  /** A different shape for particular operators, replacing `pattern` for them. */
  operators?: Partial<Record<FilterOperator, FilterValuePattern>>
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
  /**
   * What "no value" means for this field: a condition matching exactly the
   * rows where it has none. Set it only on a field that can be empty. It is
   * what offers `field:!` (is empty) and `-field:!` (is not empty), and the
   * engine ORs it into every negated token on the field, so "is not" keeps the
   * rows with no value that SQL's `NOT` would drop. Without it, `field:!`
   * degrades to free text.
   */
  empty?: FilterCondition
  /** Serializable suggestion metadata for the client. */
  suggestions: {
    valueSource: FilterValueSource
    /**
     * The shape a typed value must take. The Filter builder explains a value
     * that does not match rather than applying it. Omit it when any text maps.
     */
    valueFormat?: FilterValueFormat
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
  /** The shape a typed value must take, when the field states one. */
  valueFormat?: FilterValueFormat
  /** Whether the field can be empty, and so takes `field:!` and `-field:!`. */
  canBeEmpty?: boolean
}
