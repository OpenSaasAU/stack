// @opensaas/stack-core/testing
//
// The Test context (ADR-0057): a real, fully secured context over an
// in-process Postgres, and the recording middleware that lets a test assert on
// the plan the engine built. The only double the stack offers — nothing here
// fakes the secured surface.

export {
  createTestContext,
  createTestDatabase,
  DevDatabaseUnavailableError,
  ESCAPE_DATABASE_PREFIX,
  OrmCollectionMissingError,
  SchemaApplyError,
  type TestContext,
  type TestDatabase,
  type TestDatabaseOptions,
} from './context.js'
export {
  ESCAPE_VARIABLE,
  readDatabaseEscape,
  requireUsableDatabaseEscape,
  UnusableDatabaseEscapeError,
  type DatabaseEscape,
} from './escape.js'
export {
  ExtensionPackUnavailableError,
  loadExtensionPacks,
  type ExtensionControlDescriptor,
  type ExtensionPackDescriptor,
  type ExtensionRuntimeDescriptor,
  type LoadedExtensionPack,
  type LoadedExtensionPacks,
} from './extensions.js'
export {
  createPlanRecorder,
  type DraftPlan,
  type PlanRecorder,
  type RecordedPlan,
} from './plans.js'
