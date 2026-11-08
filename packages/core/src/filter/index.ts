// Filter engine (ADR-0017, ADR-0083): query string ⇄ structured query → Where.

export {
  parseFilterQuery,
  filterTermTokens,
  filterQueryTokens,
  FILTER_GROUP_KEYWORD,
  FILTER_OPERATOR_PREFIXES,
  FILTER_COMPARISON_PREFIXES,
} from './parse.js'
export { serializeFilterQuery, quoteFilterValue } from './serialize.js'
export { filterTokenRecordId, filterValueRecordId, recordIdFilterToken } from './record-id.js'
export {
  buildFilterWhere,
  filterTokenFreeTextWord,
  isEmptyFilterToken,
  isFieldConditionToken,
  supportsFilterRange,
  filterTokenOperators,
  effectiveFilterToken,
} from './map.js'
export type { FilterFieldCapabilities } from './map.js'
export {
  collectFilterSpecs,
  buildListFilterWhere,
  collectFilterSuggestions,
  filterSuggestionsOf,
  isFieldFilterableById,
} from './collect.js'
export type { FilterAccessArgs } from './collect.js'
export type {
  FilterOperator,
  FilterTokenOperator,
  FilterDatePicker,
  FilterToken,
  FilterValue,
  FilterGroup,
  FilterTerm,
  FilterQuery,
  FilterCondition,
  FilterSpec,
  FilterNegation,
  FilterValueSource,
  FilterValueFormat,
  FilterValuePattern,
  FilterFieldSuggestion,
} from './types.js'
