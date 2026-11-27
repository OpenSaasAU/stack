// The reserved failure codes, the host's refusal statuses and the name and code
// patterns. Imports nothing, so the browser client shares them with the host.

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

export const FAILURE_STATUS: Readonly<Record<ReservedFailureCode, number>> = {
  UNAUTHENTICATED: 401,
  DENIED: 403,
  INVALID_INPUT: 400,
  VALIDATION: 400,
  RETRY: 409,
  CONFLICT: 409,
  INTERNAL: 500,
}

/** What a procedure name is. A host serves no other. */
export const PROCEDURE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

/** What a declared failure code is. */
export const DECLARED_FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/

/**
 * The statuses the HTTP host refuses a request under before the pipeline
 * runs, each answered `{ error: "<message>" }` rather than with the envelope.
 */
export const REFUSAL_STATUS = {
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  BODY_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
} as const

const REFUSALS: ReadonlySet<number> = new Set<number>(Object.values(REFUSAL_STATUS))

/** Whether `status` is one the HTTP host refuses a request under. */
export function isRefusalStatus(status: number): boolean {
  return REFUSALS.has(status)
}
