import type { ProcedureContext, ProcedureHostContext } from './procedure.js'

/**
 * The face of an application context a procedure is handed: a new object
 * carrying the four members a procedure may reach and nothing else. It is
 * built rather than typed down, so `sudo`, `unsafe`, `withSession`,
 * `serverAction` and the engine face are absent from the value itself.
 */
export function procedureContextOf<C extends ProcedureHostContext>(
  context: C,
): ProcedureContext<C> {
  return Object.freeze({
    db: context.db,
    session: context.session,
    storage: context.storage,
    plugins: context.plugins,
  })
}
