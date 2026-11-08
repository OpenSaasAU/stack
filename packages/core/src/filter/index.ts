// Filter engine (ADR-0017, ADR-0083): query string ⇄ structured query → Where.

export { parseFilterQuery, FILTER_OPERATOR_PREFIXES, FILTER_COMPARISON_PREFIXES } from './parse.js'
export { serializeFilterQuery } from './serialize.js'
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
  isFieldFilterableById,
} from './collect.js'
export type { FilterAccessArgs } from './collect.js'
export type {
  FilterOperator,
  FilterTokenOperator,
  FilterDatePicker,
  FilterToken,
  FilterValue,
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
