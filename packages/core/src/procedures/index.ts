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
  type ProcedureHostContext,
  type ProcedureRegistry,
  type ProcedureRunArgs,
  type ProcedureSurface,
} from './procedure.js'
export {
  createProcedureHandler,
  ProcedureHostError,
  type ProcedureHandlerOptions,
  type SessionOf,
} from './http.js'
export {
  RESERVED_FAILURE_CODES,
  type ProcedureFailure,
  type ProcedureResult,
  type ReservedFailureCode,
} from './result.js'
