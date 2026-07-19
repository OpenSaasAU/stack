// ───────────────────────────────────────────────────────────────
// Filter engine (ADR-0017)
//
// The pure boundary behind the admin UI's Filter builder:
//   • parseFilterQuery  — query string → Filter tokens
//   • buildFilterWhere  — tokens + Filter specs → Prisma where fragment
// plus config-aware helpers that collect each field's Filter spec and compose
// the two steps for a list. All of this stays free of DB/Prisma imports so the
// grammar contract (including graceful degradation) is unit-testable.
// ───────────────────────────────────────────────────────────────

export { parseFilterQuery } from './parse.js'
export { buildFilterWhere } from './map.js'
export { collectFilterSpecs, buildListFilterWhere, collectFilterSuggestions } from './collect.js'
export type {
  FilterOperator,
  FilterToken,
  FilterCondition,
  FilterSpec,
  FilterValueSource,
  FilterFieldSuggestion,
} from './types.js'
