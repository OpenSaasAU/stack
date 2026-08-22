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
  ListIndex,
  ListIndexFieldRef,
  FieldConfig,
  OperationAccess,
  // Custom Bulk actions (issue #736) — declared per list in
  // `ui.listView.bulkActions`; the handler runs server-side over the selected
  // ids through the secured context.
  BulkAction,
  BulkActionContext,
  BulkActionResult,
  BulkActionVariant,
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
export { getDbKey, getUrlKey, getListKeyFromUrl, resolveListKeyFromUrl } from './lib/case-utils.js'

// Label seam — resolves the field that represents a row as a single label
// (projection) and reads it off a row (render). Used by the admin UI for
// relationship cells, dropdown options, and page headings.
export { getLabelFieldName, getItemLabel } from './config/label.js'

// Access-scoped nav counts — resolves per-list record counts (opt-in via
// `ui.navCount`) through the secured context for the admin chrome (issue #735).
export { resolveNavCounts, isListQueryStaticallyDenied } from './config/nav-count.js'

// Validation error surfaced by write operations
export { ValidationError } from './hooks/index.js'

// Resolves which columns (and, where recoverable, which named constraint) a
// caught P2002 unique-constraint violation hit — normalising Prisma 7 driver
// adapters' undocumented error shape to the documented `meta.target` one, so
// a caller of `context.db.*` never needs to reach into adapter internals
// (see issue #979).
export { uniqueConstraintOf } from './lib/prisma-errors.js'
export type { UniqueConstraintInfo } from './lib/prisma-errors.js'

// Thrown by a read when a caller-supplied `include` names a relation nested
// deeper than the Access Filter can scope (see ADR-0022). Distinct from
// `ValidationError` — this is the engine refusing to return unscoped data, not
// a user-input validation failure.
export { AccessScopeDepthExceededError } from './access/index.js'

// Thrown by a `resolveOutput` hook whose own read cycles back into a
// `(list, field)` pair already on its resolve chain (see ADR-0023). Distinct
// from `ValidationError` for the same reason as `AccessScopeDepthExceededError`.
export { ResolveOutputCycleError } from './access/index.js'

// Thrown by `checkFieldAccess` when a field-level access control function
// returns anything other than a strict boolean (see ADR-0001 and ADR-0030).
// Distinct from `ValidationError` for the same reason as
// `AccessScopeDepthExceededError` — this is the engine refusing to interpret
// a result it cannot treat as an allow/deny decision, not a user-input
// validation failure.
export { InvalidFieldAccessResultError } from './access/index.js'

// Thrown by the write pipeline's create strategy and by the nested-create
// path when operation-level `create` access returns anything other than a
// strict boolean (see #1009, ADR-0022, and ADR-0030). A filter — the shape
// `query`/`update`/`delete` legitimately return — cannot be honoured on
// create: there is no existing row and no way to test it against input data,
// so it is refused loudly rather than silently treated as a full allow.
export { InvalidCreateAccessResultError } from './access/index.js'

// Thrown by a read when a caller-supplied `where` filters on a relation whose
// related list denies operation-level `query` access outright (see #916 and
// ADR-0022). Distinct from `ValidationError` for the same reason as
// `AccessScopeDepthExceededError` — this is the engine declining to return a
// silently-narrowed match on a relation it cannot scope, not a user-input
// validation failure.
export { RelationFilterAccessDeniedError } from './access/index.js'

// Field self-containment validation — checks each field implements the
// generation contract (getPrismaType / getTypeScriptType / getZodSchema, or
// getPrismaRelation for relationships) so a misimplemented field fails early
// with a clear per-field message instead of deep inside generation.
export { validateFieldConfig, validateConfigFields } from './validation/field-config.js'
export type { FieldConfigValidationError } from './validation/field-config.js'

// Declared-dependency validation (`needs`, ADR-0025) — checks every `needs`
// entry names an immediate relationship field on the same list, and that no
// field's declaration closure (the recursive fold of its dependencies, and
// theirs) exceeds the read-include depth cap from any starting point. A
// config that fails either must not generate.
export { validateNeedsDeclarations, validateNeedsClosureDepth } from './validation/needs-closure.js'
export type { NeedsClosureError } from './validation/needs-closure.js'

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
  RELATIONSHIP_COUNT_FILTER_KEY,
} from './filter/index.js'
export type {
  FilterOperator,
  FilterToken,
  FilterCondition,
  FilterSpec,
  FilterValueSource,
  FilterFieldSuggestion,
  RelationshipCountFilterMarker,
  FilterAccessArgs,
} from './filter/index.js'

// Access-scoped to-many relationship counts for the admin list view (#732):
// build the filtered `_count` select for count cells/sort, and resolve the
// count Filter spec's markers into `{ id: { in } }` — all through the secured
// context, so counts never include related rows the session cannot read.
export {
  buildRelationshipCountSelect,
  resolveRelationshipCountFilters,
  isToManyRelationshipField,
} from './access/relationship-count.js'

// To-one relationship label filter helpers for the admin list view (#749).
// `resolveRelationshipLabelFilters` is now a pass-through: the engine itself
// scopes every relation filter in `where` (`buildAccessScopedWhere`, #916),
// including the `{ is: {...} } }` shape a label filter produces, so this no
// longer needs its own access fold. Kept exported, unchanged in shape, for
// API compatibility — see `relationship-label-filter.ts`'s doc comment.
export {
  resolveRelationshipLabelFilters,
  isToOneRelationshipField,
} from './access/relationship-label-filter.js'
