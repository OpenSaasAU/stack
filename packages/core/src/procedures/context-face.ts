import type { ProcedureContext, ProcedureHostContext } from './procedure.js'

/** The runtime-narrowed context a procedure is handed. See ADR-0086. */
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
