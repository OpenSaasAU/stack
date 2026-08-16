// ───────────────────────────────────────────────────────────────
// @opensaas/stack-core/internal
//
// @internal — plumbing shared between the @opensaas/* packages and the
// code emitted by the generator (`.opensaas/`). NOT a public API: these
// exports carry NO semver guarantees and may change or disappear in any
// release. Application authors should never import from this path; use
// the root entry point, `/fields`, or `/extend` instead.
// ───────────────────────────────────────────────────────────────

// Runtime context internals consumed by generated `.opensaas/` code
export type { ServerActionProps } from './context/index.js'
export type {
  PrismaClientLike,
  AccessControlledDB,
  StorageUtils,
  AugmentedFindMany,
  AugmentedFindUnique,
  FindManyQueryArgs,
} from './access/types.js'

// Typed-query internals (Fragment/FieldSelection appear in generated types)
export type { Fragment, FieldSelection } from './query/index.js'

// Password hashing internals (the password field emits HashedPassword into generated types)
export {
  hashPassword,
  comparePassword,
  isHashedPassword,
  HashedPassword,
} from './utils/password.js'

// Case conversion helpers used by sibling packages
export { pascalToCamel, pascalToKebab, kebabToPascal, kebabToCamel } from './lib/case-utils.js'

// Zod schema helpers used internally for validation
export { validateWithZod, generateZodSchema } from './validation/schema.js'

// Canonical field-level access evaluator, reused by @opensaas/stack-ui to decide
// whether a Relationship-table cell may show an inline-edit affordance (#737).
// This is the single field-access evaluator — the UI must not re-implement it.
export { checkFieldAccess } from './access/index.js'

// Predicate-time field-read evaluator (#915), reused by @opensaas/stack-ui to
// keep the admin list view's sort validation in lockstep with the engine: a
// field the session cannot read cannot seed an `orderBy` either.
export { isFieldReadableForPredicate } from './access/index.js'

// Config-shape sub-types consumed by sibling packages (not part of the consumer surface)
export type {
  DatabaseConfig,
  SessionConfig,
  ThemeConfig,
  ThemePreset,
  ThemeColors,
  ThemeFonts,
  ThemeShadows,
  FileMetadata,
  ImageMetadata,
  ImageTransformationResult,
} from './config/index.js'
