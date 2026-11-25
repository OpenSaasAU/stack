import type * as z from 'zod'
import { procedureContextOf } from './context-face.js'
import type { Procedure, ProcedureHostContext } from './procedure.js'
import { failure, failureFromError, type ProcedureResult } from './result.js'

/** Reads the caller's raw input. Called only once access has admitted the call. */
export type InputReader = () => { ok: true; value: unknown } | { ok: false }

/** Everything one call needs once a host has resolved the name and the identity. */
export interface ProcedureCall<C extends ProcedureHostContext> {
  name: string
  procedure: Procedure<C>
  session: C['session']
  context: () => Promise<C>
  readInput: InputReader
  /** Told of every error whose message does not reach the caller. */
  onUnexpectedError: (error: unknown, procedureName: string) => void
}

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '(root)'
    if (!(key in fieldErrors)) fieldErrors[key] = issue.message
  }
  return fieldErrors
}

/**
 * Run one procedure for an already-resolved session: access, then input
 * parsing, then `run`, then output parsing. Access runs before the input is
 * read and never sees it, so a decision to list a procedure and a decision to
 * call it can be the same one.
 */
export async function runProcedure<C extends ProcedureHostContext>(
  call: ProcedureCall<C>,
): Promise<ProcedureResult<unknown>> {
  const { name, procedure, session } = call
  const internal = (error: unknown): void => call.onUnexpectedError(error, name)

  try {
    const context = procedureContextOf(await call.context())

    const admitted = await procedure.access({ session, context })
    if (admitted !== true) return failure(session === null ? 'UNAUTHENTICATED' : 'DENIED')

    const raw = call.readInput()
    if (!raw.ok) return failure('INVALID_INPUT')
    const input = procedure.input.safeParse(raw.value)
    if (!input.success) {
      return failure('INVALID_INPUT', { fieldErrors: fieldErrorsOf(input.error) })
    }

    const returned = await procedure.run({ input: input.data, context })

    const output = procedure.output.safeParse(returned)
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
