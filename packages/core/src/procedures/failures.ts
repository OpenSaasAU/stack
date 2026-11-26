import { processGlobal } from '../lib/process-global.js'

/**
 * Constructs one of a procedure's declared failures, for `run` to **throw**.
 * Throwing is what rolls back an open transaction; a failure returned from a
 * transaction callback would commit the writes before it.
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
 * the procedure that declares its code with `{ success: false, error: { code,
 * message } }`; thrown anywhere else it is an unexpected error.
 */
export class ProcedureFailureError<TCode extends string = string> extends Error {
  readonly code: TCode

  constructor(code: TCode, message: string) {
    super(message)
    this.name = 'ProcedureFailureError'
    this.code = code
  }
}

function isWeakSet(value: unknown): value is WeakSet<object> {
  return value instanceof WeakSet
}

function constructedFailures(): WeakSet<object> {
  return processGlobal('procedure-failures', isWeakSet, () => new WeakSet<object>())
}

function hasStringCode(value: object): value is { code: string } {
  return 'code' in value && typeof value.code === 'string'
}

/** The code and message of a failure `fail` constructed, or `undefined` for anything else. */
export function declaredFailureOf(error: unknown): { code: string; message: string } | undefined {
  if (!(error instanceof Error) || !constructedFailures().has(error)) return undefined
  return hasStringCode(error) ? { code: error.code, message: error.message } : undefined
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
    constructedFailures().add(error)
    return error
  }
}
