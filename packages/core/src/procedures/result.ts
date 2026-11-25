import { ValidationError } from '../hooks/index.js'
import { isClientSafeError } from '../lib/client-safe-error.js'
import { DatabaseError, isSerializationFailure } from '../lib/database-errors.js'

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

/** A failed call. `fieldErrors` is present on `INVALID_INPUT` and `VALIDATION`. */
export interface ProcedureFailure {
  code: ReservedFailureCode
  message: string
  fieldErrors?: Record<string, string>
}

/** The result of calling a procedure, on every surface. */
export type ProcedureResult<TData> =
  { success: true; data: TData } | { success: false; error: ProcedureFailure }

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

/**
 * The failure a thrown error becomes. Only what the client-safe rule admits
 * keeps its message; anything else is `INTERNAL`, and `internal` is told so
 * the caller can log it.
 */
export function failureFromError(
  error: unknown,
  internal: (error: unknown) => void,
): { success: false; error: ProcedureFailure } {
  if (error instanceof ValidationError) {
    return failure('VALIDATION', { message: error.message, fieldErrors: error.fieldErrors })
  }
  if (isSerializationFailure(error)) return failure('RETRY')
  if (error instanceof DatabaseError) return failure('CONFLICT', { message: error.message })
  if (isClientSafeError(error)) return failure('INVALID_INPUT', { message: error.message })
  internal(error)
  return failure('INTERNAL')
}
