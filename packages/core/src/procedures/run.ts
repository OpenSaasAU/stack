import type * as z from 'zod'
import { declaredFailureOf } from './failures.js'
import type { Procedure, ProcedureHostContext } from './procedure.js'
import { failure, failureFromError, type ProcedureResult } from './result.js'

/** The caller's raw input, or `ok: false` when it could not be decoded. */
export type RawInput = { ok: true; value: unknown } | { ok: false }

/**
 * Reads the caller's raw input. Called only once access has admitted the
 * call, so a host that reads lazily consumes nothing for a refused one. A
 * rejection is reported as `INTERNAL`.
 */
export type InputReader = () => RawInput | Promise<RawInput>

/** Everything one call needs once a host has resolved the name and the identity. */
export interface ProcedureCall<C extends ProcedureHostContext> {
  name: string
  procedure: Procedure<C>
  /** The context the call runs in. Its `session` is the caller's identity. */
  context: () => Promise<C>
  readInput: InputReader
  onUnexpectedError: UnexpectedErrorReporter
}

export type UnexpectedErrorReporter = (error: unknown, procedureName: string) => void

/** A reporter that cannot throw or leave a rejection unhandled: a failing one falls back to `console.error`. */
export function guardReporter(report: UnexpectedErrorReporter): UnexpectedErrorReporter {
  return (error, procedureName) => {
    const fallback = (reporterError: unknown): void => {
      console.error(
        `onUnexpectedError threw while reporting procedure "${procedureName}":`,
        reporterError,
        error,
      )
    }
    try {
      const returned: unknown = report(error, procedureName)
      if (isThenable(returned)) void Promise.resolve(returned).catch(fallback)
    } catch (reporterError) {
      fallback(reporterError)
    }
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  )
}

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const fieldErrors = new Map<string, string>()
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '(root)'
    if (!fieldErrors.has(key)) fieldErrors.set(key, issue.message)
  }
  return Object.fromEntries(fieldErrors)
}

/** The pipeline every host shares. See ADR-0086. */
export async function runProcedure<C extends ProcedureHostContext>(
  call: ProcedureCall<C>,
): Promise<ProcedureResult<unknown, string>> {
  const { name, procedure } = call
  const internal = (error: unknown): void => call.onUnexpectedError(error, name)

  try {
    const context = await call.context()

    const admitted = await procedure.access({ context })
    if (admitted !== true) {
      return failure(context.session === null ? 'UNAUTHENTICATED' : 'DENIED')
    }

    const raw = await call.readInput()
    if (!raw.ok) return failure('INVALID_INPUT')
    const input = await procedure.input.safeParseAsync(raw.value)
    if (!input.success) {
      return failure('INVALID_INPUT', { fieldErrors: fieldErrorsOf(input.error) })
    }

    let returned: unknown
    try {
      returned = await procedure.run({ input: input.data, context })
    } catch (error) {
      const declared = declaredFailureOf(error)
      if (declared !== undefined && Object.hasOwn(procedure.failures, declared.code)) {
        return { success: false, error: declared }
      }
      throw error
    }

    const output = await procedure.output.safeParseAsync(returned)
    if (!output.success) {
      internal(
        new Error(`Procedure "${name}" returned output that does not match its output schema`, {
          cause: output.error,
        }),
      )
      return failure('INTERNAL')
    }
    return { success: true, data: output.data }
  } catch (error) {
    return failureFromError(error, internal)
  }
}
