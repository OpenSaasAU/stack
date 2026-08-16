export type {
  AccessControl,
  FieldAccess,
  Session,
  AccessContext,
  PrismaFilter,
  AccessControlledDB,
  PrismaClientLike,
  StorageUtils,
  AugmentedFindMany,
  AugmentedFindUnique,
  FindManyQueryArgs,
} from './types.js'
// Operation-level access primitives and shared ref-parsing helper.
export {
  checkAccess,
  mergeFilters,
  isBoolean,
  isPrismaFilter,
  getRelatedListConfig,
} from './engine.js'
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
export { buildAccessScopedInclude, stripVirtualFieldsFromInclude } from './access-filter.js'
// Phase 2 — Field Visibility (post-query field stripping + resolveOutput).
export { filterReadableFields } from './field-visibility.js'
// Declared Dependencies — folding `needs` into an include without widening
// the result (ADR-0025).
export {
  foldDeclaredDependencies,
  getDeclaredRelationNames,
  emptyDeclaredOnlyTree,
} from './declared-dependencies.js'
export type { DeclaredOnlyTree } from './declared-dependencies.js'
// Thrown when a caller include reaches past the depth the Access Filter can scope.
export { AccessScopeDepthExceededError } from './errors.js'
// Thrown when a resolveOutput hook's own resolve chain cycles back into itself.
export { ResolveOutputCycleError } from './errors.js'
// Thrown when a field-level access control function returns a non-boolean result.
export { InvalidFieldAccessResultError } from './errors.js'
