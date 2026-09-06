export type {
  AccessControl,
  FieldAccess,
  Session,
  AccessContext,
  PrismaFilter,
  AccessControlledDB,
  AccessControlledDelegate,
  OrmClient,
  OrmModelDelegate,
  OrmOperationArgs,
  OrmRow,
  StorageUtils,
} from './types.js'
// Operation-level access primitives and shared ref-parsing helper.
export {
  checkAccess,
  checkCreateAccess,
  mergeFilters,
  isBoolean,
  isPrismaFilter,
  getRelatedListConfig,
  resolveSyntheticReverseRelation,
  listSyntheticReverseRelationNames,
} from './engine.js'
export type { SyntheticReverseRelation } from './engine.js'
// Canonical field-level access evaluation (shared by read and write paths).
export {
  checkFieldAccess,
  filterWritableFields,
  isFieldReadableForPredicate,
} from './field-access.js'
// Read-path key validation — the `findMany`/`count` counterpart to the write
// path's #564 undeclared-key reject.
export { validateQueryKeys } from './query-validation.js'
// Read-path field-level access on `where`/`orderBy` keys — a field the
// session cannot read cannot be named in a predicate either (#915).
export { validateQueryFieldReadAccess } from './query-validation.js'
// Phase 1 — Access Filter (pre-query row/relation scoping).
export {
  buildAccessScopedInclude,
  buildAccessScopedWhere,
  stripVirtualFieldsFromInclude,
  resolveToOneAccessVisibility,
  emptyToOneAccessFilterTree,
  emptyToOneAccessVisibilityTree,
  emptyCountAccessDenialTree,
} from './access-filter.js'
export type {
  ToOneAccessFilterTree,
  ToOneAccessFilterEntry,
  ToOneAccessVisibilityTree,
  ToOneVisibility,
  CountAccessDenialTree,
} from './access-filter.js'
// Access-scoped to-many relationship counts (admin list view, issue #732)
// and the shared per-relation resolver `_count` scoping (issue #1087) reuses.
export { isToManyRelationshipField, resolveCountAccessEntryForList } from './relationship-count.js'
export type { CountAccessEntry } from './relationship-count.js'
// Phase 2 — Field Visibility (post-query field stripping + resolveOutput).
export { filterReadableFields } from './field-visibility.js'
// Declared Dependencies — widening a read for the emitted `needs` sets
// without widening the result (ADR-0025, ADR-0051).
export {
  widenIncludeForDependencies,
  resolveDeclaredDependencies,
  getDependencyTable,
  getListDependencies,
  noDependencyAdditions,
} from './declared-dependencies.js'
export type { DependencyAdditions, FieldSelectionScope } from './declared-dependencies.js'
// Thrown when a caller include reaches past the depth the Access Filter can scope.
export { AccessScopeDepthExceededError } from './errors.js'
// Thrown when a resolveOutput hook's own resolve chain cycles back into itself.
export { ResolveOutputCycleError } from './errors.js'
// Thrown when a field-level access control function returns a non-boolean result.
export { InvalidFieldAccessResultError } from './errors.js'
// Thrown when operation-level `create` access control returns a non-boolean result (#1009).
export { InvalidCreateAccessResultError } from './errors.js'
// Thrown when an access rule returns a filter carrying an `undefined` condition (#1147).
export { UndefinedAccessFilterError } from './errors.js'
// Thrown when a relation filter's related list denies query access outright (#916).
export { RelationFilterAccessDeniedError } from './errors.js'
// Thrown when a caller `include` names a key that is neither declared, synthetic, nor `_count` (#1082).
export { UndeclaredIncludeKeyError } from './errors.js'
// Thrown when a caller `_count.select` names a key that is not a countable to-many relation (#1087).
export { UndeclaredCountKeyError } from './errors.js'
