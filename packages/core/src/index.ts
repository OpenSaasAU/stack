// ───────────────────────────────────────────────────────────────
// @opensaas/stack-core — consumer entry point
//
// The everyday surface for defining a config and using a context.
//   • Field builders            → '@opensaas/stack-core/fields'
//   • Plugin / field authoring  → '@opensaas/stack-core/extend'
//   • MCP runtime               → '@opensaas/stack-core/mcp'
// Internal plumbing lives on '@opensaas/stack-core/internal' (unstable).
// ───────────────────────────────────────────────────────────────

// Config builders
export { config, list } from './config/index.js'

// Config types a consumer annotates with.
// Concrete field-config types (TextField, …) live on '@opensaas/stack-core/fields'
// alongside their builders.
export type {
  OpenSaasConfig,
  OutputConfig,
  ListConfig,
  DatabaseConfig,
  FieldConfig,
  OperationAccess,
} from './config/index.js'

// Access control — the types a consumer writes against
export type {
  AccessControl,
  FieldAccess,
  Session,
  AccessContext,
  PrismaFilter,
} from './access/index.js'

// Context factory
export { getContext } from './context/index.js'
export type {
  StackContext,
  TransactionOptions,
  TransactionIsolationLevel,
} from './context/index.js'

// Naming utilities (documented public helpers; used for URLs and db keys)
export { getDbKey, getUrlKey, getListKeyFromUrl } from './lib/case-utils.js'

// Label seam — resolves the field that represents a row as a single label
// (projection) and reads it off a row (render). Used by the admin UI for
// relationship cells, dropdown options, and page headings.
export { getLabelFieldName, getItemLabel } from './config/label.js'

// Validation error surfaced by write operations
export { ValidationError } from './hooks/index.js'

// Field self-containment validation — checks each field implements the
// generation contract (getPrismaType / getTypeScriptType / getZodSchema, or
// getPrismaRelation for relationships) so a misimplemented field fails early
// with a clear per-field message instead of deep inside generation.
export { validateFieldConfig, validateConfigFields } from './validation/field-config.js'
export type { FieldConfigValidationError } from './validation/field-config.js'

// Fragment-based query API — composable, type-safe reads that mirror
// Keystone's GraphQL fragments without a GraphQL runtime. The migration
// guide, CHANGELOG, and migrate-context-calls skill all advertise importing
// these from the root entry point. The internal runtime helpers (isFragment,
// buildInclude, pickFields) and the Fragment/FieldSelection types stay off the
// root surface — those live on '@opensaas/stack-core/internal'.
export { defineFragment, runQuery, runQueryOne } from './query/index.js'
export type { ResultOf, RelationSelector, QueryArgs } from './query/index.js'

// Relationship-options read primitive — bounded, projected fetch for
// relationship editors. Backs the `relationshipOptions` context.serverAction
// op; also callable directly wherever a full context is already in hand.
export { getRelationshipOptions } from './query/relationship-options.js'
export type { RelationshipOption, RelationshipOptionsArgs } from './query/relationship-options.js'

// Filter engine (ADR-0017) — the admin UI's Filter builder. The pure seam
// (`parseFilterQuery`, `buildFilterWhere`) plus config-aware helpers that
// collect each field's Filter spec and compose a list's server-side `where`.
// The produced fragment is ANDed with the access filter through the secured
// context, so the filter can only ever narrow visibility.
export {
  parseFilterQuery,
  serializeFilterQuery,
  buildFilterWhere,
  collectFilterSpecs,
  buildListFilterWhere,
  collectFilterSuggestions,
} from './filter/index.js'
export type {
  FilterOperator,
  FilterToken,
  FilterCondition,
  FilterSpec,
  FilterValueSource,
  FilterFieldSuggestion,
} from './filter/index.js'
