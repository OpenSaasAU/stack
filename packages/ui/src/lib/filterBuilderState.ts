import {
  parseFilterQuery,
  serializeFilterQuery,
  type FilterFieldSuggestion,
  type FilterOperator,
  type FilterToken,
} from '@opensaas/stack-core'

/**
 * One structured condition row in the Filter builder: a field, an operator the
 * field's spec supports, and the raw value the user typed or picked. `id` is a
 * stable React key, never serialised into the query.
 */
export interface FilterRow {
  id: string
  field: string
  operator: FilterOperator
  value: string
}

/**
 * The Filter builder's editable state: structured field-scoped rows plus a
 * single free-text box for bare-word search. Together they serialise to the one
 * `?search=` query the filter engine consumes.
 */
export interface FilterBuilderState {
  rows: FilterRow[]
  freeText: string
}

/**
 * Hydrate the builder from an existing `?search=` query, using the list's
 * serializable {@link FilterFieldSuggestion}s to decide which tokens can be
 * shown as structured rows.
 *
 * A token becomes a row only when its field has a suggestion, the suggestion
 * lists the token's operator, and the value is non-empty — mirroring exactly the
 * conditions under which the engine's `buildFilterWhere` produces a condition
 * rather than degrading to free text. Everything else (bare words, unknown
 * fields, unsupported operators) is re-serialised back into the free-text box so
 * the builder can round-trip any query the engine accepts without losing tokens.
 */
export function queryToState(
  query: string,
  suggestions: FilterFieldSuggestion[],
): FilterBuilderState {
  const suggestionByField = new Map(suggestions.map((s) => [s.field, s]))
  const tokens = parseFilterQuery(query)

  const rows: FilterRow[] = []
  const freeTokens: FilterToken[] = []
  let counter = 0

  for (const token of tokens) {
    if (token.field !== null) {
      const suggestion = suggestionByField.get(token.field)
      if (suggestion && suggestion.operators.includes(token.operator) && token.value !== '') {
        rows.push({
          id: `row-${counter++}`,
          field: token.field,
          operator: token.operator,
          value: token.value,
        })
        continue
      }
    }
    freeTokens.push(token)
  }

  return { rows, freeText: serializeFilterQuery(freeTokens) }
}

/**
 * Serialise the builder's state back into a single `?search=` query string.
 * Empty rows (no field or no value) are dropped; the free-text box is re-parsed
 * so a user who types `status:draft` into it is normalised the same way a
 * structured row would be. The result is the exact grammar
 * {@link parseFilterQuery} consumes.
 */
export function stateToQuery(state: FilterBuilderState): string {
  const rowTokens: FilterToken[] = state.rows
    .filter((row) => row.field !== '' && row.value !== '')
    .map((row) => ({ field: row.field, operator: row.operator, value: row.value, raw: '' }))

  const freeTokens = parseFilterQuery(state.freeText)

  return serializeFilterQuery([...rowTokens, ...freeTokens])
}
