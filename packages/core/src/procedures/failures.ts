import { processGlobal } from '../lib/process-global.js'

/**
 * Constructs one of a procedure's declared failures, for `run` to **throw**.
 * Throwing is what rolls back an open transaction. A failure returned from
 * `run` or from a `context.transaction` callback is treated as thrown.
 *
 * @param code - one of the codes the procedure declares in `failures`.
 * @param message - replaces the declared message for this one failure.
 */
export type ProcedureFail<TCode extends string> = (
  code: TCode,
  message?: string,
) => ProcedureFailureError<TCode>

/**
 * A declared failure, as `fail` constructs it. A host answers one thrown by
 * the procedure whose `fail` constructed it with `{ success: false, error: {
 * code, message } }`; thrown anywhere else it is an unexpected error.
 */
export class ProcedureFailureError<TCode extends string = string> extends Error {
  readonly code: TCode

  constructor(code: TCode, message: string) {
    super(message)
    this.name = 'ProcedureFailureError'
    this.code = code
  }
}

function isWeakMap(value: unknown): value is WeakMap<object, object> {
  return value instanceof WeakMap
}

function failureOwners(): WeakMap<object, object> {
  return processGlobal('procedure-failure-owners', isWeakMap, () => new WeakMap<object, object>())
}

function hasStringCode(value: object): value is { code: string } {
  return 'code' in value && typeof value.code === 'string'
}

/**
 * The code and message of a failure constructed by the `fail` of the procedure
 * whose frozen `failures` object is given, or `undefined` for anything else.
 */
export function declaredFailureOf(
  error: unknown,
  failures: object,
): { code: string; message: string } | undefined {
  if (!(error instanceof Error) || failureOwners().get(error) !== failures) return undefined
  if (!hasStringCode(error) || !Object.hasOwn(failures, error.code)) return undefined
  return { code: error.code, message: error.message }
}

/** Throws `value` when any procedure's `fail` constructed it, so a returned failure acts as a thrown one. */
export function throwReturnedFailure(value: unknown): void {
  if (value instanceof Error && failureOwners().has(value)) throw value
}

/** The `fail` helper for a procedure declaring `failures`. */
export function failWith<TCode extends string>(
  failures: Readonly<Partial<Record<TCode, string>>>,
): ProcedureFail<TCode> {
  return (code, message) => {
    if (!Object.hasOwn(failures, code)) {
      throw new Error(`Failure code ${JSON.stringify(code)} is not declared by this procedure.`)
    }
    const error = new ProcedureFailureError(code, message ?? failures[code] ?? code)
    failureOwners().set(error, failures)
    return error
  }
}
