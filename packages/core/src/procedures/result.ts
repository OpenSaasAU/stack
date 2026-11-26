import { AccessScopeDepthExceededError, ResolveOutputCycleError } from '../access/errors.js'
import {
  MalformedRelationInputError,
  NestedRelationInputError,
  NonOwningRelationInputError,
} from '../context/relationship-input.js'
import { ValidationError } from '../hooks/index.js'
import { isClientSafeError } from '../lib/client-safe-error.js'
import {
  DatabaseError,
  isSerializationFailure,
  isUniqueConstraintViolation,
} from '../lib/database-errors.js'

/** The failure codes the stack owns. A procedure cannot declare one of these. */
export const RESERVED_FAILURE_CODES = [
  'UNAUTHENTICATED',
  'DENIED',
  'INVALID_INPUT',
  'VALIDATION',
  'RETRY',
  'CONFLICT',
  'INTERNAL',
] as const

export type ReservedFailureCode = (typeof RESERVED_FAILURE_CODES)[number]

const RESERVED: ReadonlySet<string> = new Set<string>(RESERVED_FAILURE_CODES)

/** Whether `code` is one of the codes the stack owns. */
export function isReservedFailureCode(code: string): code is ReservedFailureCode {
  return RESERVED.has(code)
}

/**
 * A failed call. `code` is a reserved code or one the procedure declares.
 * `fieldErrors` is present when the failure names fields: on `INVALID_INPUT`
 * and `VALIDATION`, and on a `CONFLICT` raised by a unique constraint the
 * generator emitted, where it names the fields that collided. A `CONFLICT`'s
 * keys are the list's field names, which need not be keys of the procedure's
 * input.
 *
 * `RETRY` says the transaction that lost a race was rolled back. It does not
 * say that work outside the transaction was undone, and nothing retries the
 * call automatically: the caller decides whether running it again is safe.
 *
 * @typeParam TCode - the failure codes the procedure declares.
 */
export interface ProcedureFailure<TCode extends string = never> {
  code: ReservedFailureCode | TCode
  message: string
  fieldErrors?: Record<string, string>
}

/** The result of calling a procedure, on every surface. */
export type ProcedureResult<TData, TCode extends string = never> =
  { success: true; data: TData } | { success: false; error: ProcedureFailure<TCode> }

export const FAILURE_STATUS: Readonly<Record<ReservedFailureCode, number>> = {
  UNAUTHENTICATED: 401,
  DENIED: 403,
  INVALID_INPUT: 400,
  VALIDATION: 400,
  RETRY: 409,
  CONFLICT: 409,
  INTERNAL: 500,
}

const MESSAGES: Readonly<Record<ReservedFailureCode, string>> = {
  UNAUTHENTICATED: 'Authentication required',
  DENIED: 'Access denied',
  INVALID_INPUT: 'Invalid input',
  VALIDATION: 'Validation failed',
  RETRY: 'The operation conflicted with a concurrent change and was rolled back',
  CONFLICT: 'The operation conflicted with existing data',
  INTERNAL: 'Internal error',
}

export function failure(
  code: ReservedFailureCode,
  detail: { message?: string; fieldErrors?: Record<string, string> } = {},
): { success: false; error: ProcedureFailure } {
  const error: ProcedureFailure = { code, message: detail.message ?? MESSAGES[code] }
  if (detail.fieldErrors !== undefined && Object.keys(detail.fieldErrors).length > 0) {
    error.fieldErrors = detail.fieldErrors
  }
  return { success: false, error }
}

function isEngineRefusal(error: unknown): boolean {
  return (
    error instanceof NonOwningRelationInputError ||
    error instanceof MalformedRelationInputError ||
    error instanceof NestedRelationInputError ||
    error instanceof AccessScopeDepthExceededError ||
    error instanceof ResolveOutputCycleError
  )
}

/** The failure a thrown error becomes, with `report` told of what an operator should see. See ADR-0086. */
export function failureFromError(
  error: unknown,
  report: (error: unknown) => void,
): { success: false; error: ProcedureFailure } {
  if (error instanceof ValidationError) {
    return failure('VALIDATION', { message: error.message, fieldErrors: error.fieldErrors })
  }
  if (error instanceof DatabaseError) {
    if (isSerializationFailure(error)) return failure('RETRY')
    const { message, fieldErrors } = error
    if (!isUniqueConstraintViolation(error)) report(error)
    return failure('CONFLICT', { message, fieldErrors })
  }
  if (isClientSafeError(error)) {
    if (isEngineRefusal(error)) report(error)
    return failure('INVALID_INPUT', { message: error.message })
  }
  report(error)
  return failure('INTERNAL')
}
