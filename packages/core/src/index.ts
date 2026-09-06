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
  DatabaseClientConfig,
  ExtensionDescriptor,
  IdFieldStrategy,
  ReferentialAction,
  ListIndex,
  ListIndexFieldRef,
  FieldConfig,
  OperationAccess,
  ContractLiteral,
  ColumnTypeDescriptor,
  ColumnDefaultDescriptor,
  ContractColumnDescriptor,
  ContractForeignKeyDescriptor,
  ContractRelationDescriptor,
  ContractFieldDescriptor,
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
  // The engine's internal ORM handle, and the delegate `ormModel()` narrows
  // one model to. Unsecured; an application reaches Prisma through
  // `context.unsafe`.
  OrmClient,
  OrmModelDelegate,
  OrmOperationArgs,
  OrmRow,
} from './access/index.js'

// The Unsafe surface (ADR-0056, ADR-0059)
export {
  createUnsafeSurface,
  createUnsafeTransactionSurface,
  unavailableUnsafeSurface,
  UnsafeSurfaceUnavailableError,
} from './unsafe.js'
export type { UnsafeCapableClient, UnsafeSurface, UnsafeTransactionScope } from './unsafe.js'

// The access-filter builder — supported API (ADR-0038, ADR-0057). Evaluate a
// list's operation-level rule, fold its result into the caller's `where`, and
// gate a create. A package that reads outside `context.db` — a vector search
// issuing its own SQL, a plugin composing a filter — calls these rather than
// carrying a copy. They scope ROWS only: field-level `read` access and
// `resolveOutput` run inside `context.db`, so a caller here is responsible for
// field visibility itself.
export { checkAccess, checkCreateAccess, mergeFilters } from './access/index.js'

// Context factory
export { getContext } from './context/index.js'
export type { TransactionOptions, TransactionIsolationLevel } from './context/index.js'
export { TransactionOptionsUnsupportedError, TransactionOrmHandleError } from './context/index.js'

// The contract-keyed generics the Generated bundle instantiates (ADR-0052).
// The bundle names one interface per list extending each of these, keyed by
// the emitted \`Contract\` and the generator-authored \`Remainder\`.
export type {
  ListRemainder,
  RemainderBase,
  ColumnOutputTypes,
  ColumnInputTypes,
  RelationKey,
  RelationTarget,
  IsToOne,
  OwnedRelationKey,
  ForeignKeyColumn,
  ListId,
  Row,
  StoredRow,
  NeedsRow,
  RelationValue,
  SystemFieldKey,
  CreateInput,
  UpdateInput,
  WritableColumn,
  SecuredList,
  QueryResult,
  ColumnFilter,
  ListWhere,
  ListOrderBy,
  ListUniqueWhere,
  ListSelect,
  ListInclude,
  SubArgs,
  ListFilterArgs,
  FindUniqueArgs,
  FindManyArgs,
  CountArgs,
  CreateArgs,
  CreateManyArgs,
  UpdateArgs,
  UpdateManyArgs,
  DeleteArgs,
  GetArgs,
  StackBaseContext,
  StackTransactionContext,
  StackDb,
} from './types/index.js'
export type { StackContext } from './types/context.js'

// The secured read surface: the composed query value `context.db.<List>` is,
// and the closed Where vocabulary it takes (ADR-0041, ADR-0055).
export { SecuredCollectionMissingError } from './secured/read.js'
// Thrown when an Access Filter that scopes by a relation expands into itself,
// directly or through another list's filter. Loud rather than truncated: a
// truncated Access Filter is a widened read (#1147).
export { AccessFilterRecursionError, ACCESS_FILTER_MAX_DEPTH } from './secured/read.js'
// Thrown when an include refinement callback returns something other than the
// refinement it was handed — dropping it would run the include unscoped by
// everything the caller wrote (#1148).
export { InvalidRefinementError } from './secured/read.js'
// Thrown when one read names the same relation twice, and when a nested
// include names a to-one whose foreign-key column carries the relation's own
// name — the collision #1236 removes (#1148).
export { DuplicateIncludeError, NestedToOneIncludeError } from './secured/read.js'
// The vector-search terminal: how many rows it returns by default, and the
// `{ item, score }` wrapper that is ADR-0041's one exception to exactness.
export { NEAREST_DEFAULT_LIMIT, VectorDecodeError } from './secured/read.js'
export type {
  SecuredQuery,
  SecuredRefinement,
  Refinement,
  NearestMatch,
  NearestOptions,
  OrderBy,
  OrderDirection,
  RelationCondition,
  ScalarOperators,
  VectorColumnDescriptor,
  VectorDistanceFunction,
  Where,
  WhereCondition,
  WhereValue,
} from './secured/read.js'

// Naming utilities (documented public helpers; used for URLs)
export { getUrlKey, getListKeyFromUrl, resolveListKeyFromUrl } from './lib/case-utils.js'

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

// Thrown by `mergeFilters` when an access rule returns a filter carrying an
// `undefined` condition — the shape `({ session }) => ({ authorId:
// session?.userId })` yields for an anonymous caller. Dropping it would widen
// the read to every row, so it is refused (see #1147, ADR-0022, ADR-0055).
export { UndefinedAccessFilterError } from './access/index.js'

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

// Declared-dependency validation (`needs`, ADR-0025, ADR-0051) — a config that fails it must not generate.
export { validateNeedsDeclarations } from './validation/needs-closure.js'
export type { NeedsClosureError } from './validation/needs-closure.js'

// Config-surface refusals (ADR-0040, ADR-0048, ADR-0049, ADR-0064) — the
// declarations the Prisma 8 contract cannot carry, each refused naming the
// list, the entry and the fix rather than silently dropped.
export { validateRelations } from './validation/relations.js'
export { validateDatabaseConfig } from './validation/database-config.js'
export { validateExtensionPacks } from './validation/extension-packs.js'
export { validateFieldNames } from './validation/field-names.js'
export type { ConfigRefusal, ConfigRefusalReason } from './validation/config-refusal.js'

// The stack's database URL lookup — the single place a connection string is
// chosen, emitted into `prisma.config.ts` and the generated context. The Dev
// database it can resolve to lives on `@opensaas/stack-core/dev-database`, so
// the root stays free of PGlite.
export { resolveDatabaseUrl, findDatabaseUrl, DatabaseUrlUnresolvedError } from './db/url.js'
export type {
  DatabaseUrlLookupOptions,
  DatabaseUrlProvenance,
  ResolvedDatabaseUrl,
} from './db/url.js'

// Contract derivation (ADR-0057) — `deriveContract(config)` is the data the
// generator renders into the Contract module; `assertRelationGraphAgrees`
// checks an emitted contract against it. The Prisma builder feed lives on
// `@opensaas/stack-core/contract` so the root stays free of `@prisma/orm-postgres`.
export { deriveContract, resolveListTimestamps } from './contract/derive.js'
export {
  assertRelationGraphAgrees,
  RelationGraphDivergenceError,
  type EmittedContract,
} from './contract/relation-graph.js'
export type {
  ContractColumn,
  ContractData,
  ContractEnum,
  ContractForeignKey,
  ContractIdColumn,
  ContractIdStrategy,
  ContractIndex,
  ContractModel,
  ContractRelation,
  ContractRelationKind,
  ContractTimestamps,
} from './contract/types.js'

// The two tables the generator emits into the bundle beside the four
// generated files (ADR-0051, ADR-0042). `deriveDependencyTable` is the one
// computation behind both the runtime table and the generated `Remainder`'s
// `needs` type; the engine reads the emitted result through the generated
// context rather than walking the config on every read.
export {
  deriveConstraintMap,
  deriveDependencyTable,
  deriveGeneratedTables,
} from './contract/dependencies.js'
export type {
  ConstraintMap,
  DependencyTable,
  FieldDependencySet,
  GeneratedTables,
  ListDependencies,
  UniqueConstraint,
} from './contract/dependencies.js'

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
  FilterAccessArgs,
} from './filter/index.js'

// Access-scoped to-many relationship counts for the admin list view (#732):
// the filtered `_count` select for count cells, with each related list's
// `query` access folded in, so counts never include rows the session cannot
// read. The count-filter resolver is gone with the vocabulary (ADR-0055): a
// count comparison shrinks to presence, which the engine lowers itself.
export {
  buildRelationshipCountSelect,
  isToManyRelationshipField,
} from './access/relationship-count.js'
