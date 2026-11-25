import type { ProcedureContext, ProcedureHostContext } from './procedure.js'

/**
 * The face of an application context a procedure is handed: a new object
 * carrying the four members a procedure may reach and nothing else. It is
 * built rather than typed down, so `sudo`, `unsafe`, `withSession`,
 * `serverAction` and the engine face are absent from the value itself.
 *
 * The narrowing is shallow. `plugins` is the application context's own
 * registry, and each service in it keeps whatever capabilities its plugin
 * built it with, which can include `sudo`.
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
