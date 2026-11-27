// @opensaas/stack-core/procedures
//
// Procedures: named, typed actions an application defines once and exposes on
// the surfaces it names. See ADR-0086.

export {
  createProcedureBuilder,
  isProcedure,
  ProcedureDefinitionError,
  type Procedure,
  type ProcedureAccessArgs,
  type ProcedureBuilder,
  type ProcedureContext,
  type ProcedureDefinition,
  type ProcedureExposure,
  type ProcedureFailures,
  type ProcedureHostContext,
  type ProcedureHostTransactionContext,
  type ProcedureRegistry,
  type ProcedureResultOf,
  type ProcedureRunArgs,
  type ProcedureSurface,
  type ProcedureTransactionContext,
  type TransactionContextOf,
} from './procedure.js'
export { ProcedureFailureError, type ProcedureFail } from './failures.js'
export { createProcedureHandler, type ProcedureHandlerOptions, type SessionOf } from './http.js'
export {
  createServerCaller,
  type RegistryContextOf,
  type ServerCaller,
  type ServerCallerOptions,
} from './server.js'
export {
  assertProcedureNamesAvailable,
  assertProcedureRegistry,
  assertProcedureSchemas,
  ProcedureHostError,
  type ProcedureRegistryChecks,
  type ProcedureSchemaSide,
  type ProcedureSchemas,
} from './validate.js'
export {
  RESERVED_FAILURE_CODES,
  type ProcedureFailure,
  type ProcedureResult,
  type ReservedFailureCode,
} from './result.js'
