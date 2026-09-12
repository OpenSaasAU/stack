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
  OrmClient,
  OrmModelDelegate,
  OrmOperationArgs,
  OrmRow,
  AccessControlledDB,
  AccessControlledDelegate,
  StorageUtils,
} from './access/types.js'

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

// The engine's LIKE-pattern escaping, shared with the packages that lower a
// substring predicate to `like`/`ilike` (ADR-0055, ADR-0060). One escaper.
export {
  LIKE_ESCAPE_CHARACTER,
  escapeLikeLiteral,
  likeEqualsPattern,
  likeContainsPattern,
  likeStartsWithPattern,
  likeEndsWithPattern,
} from './where/like.js'

// The lookup's provenance, which `opensaas dev` reads to tell the Database
// escape (a URL in the environment) from a Dev database it should start for
// the project itself (ADR-0063). The public accessor, `findDatabaseUrl`,
// reports the URL alone.
export { findDatabaseConnection } from './db/url.js'
