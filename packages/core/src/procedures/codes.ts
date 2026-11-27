// The reserved failure codes and their HTTP statuses. Imports nothing, so the
// browser client shares them with the host.

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
