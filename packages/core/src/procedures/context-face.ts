import type {
  ProcedureContext,
  ProcedureHostContext,
  ProcedureHostTransactionContext,
  ProcedureTransactionContext,
} from './procedure.js'

function transactionContextOf<Tx extends ProcedureHostTransactionContext>(
  transaction: Tx,
): ProcedureTransactionContext<Tx> {
  const face: ProcedureTransactionContext<Tx> = Object.freeze({
    db: transaction.db,
    session: transaction.session,
    storage: transaction.storage,
    plugins: transaction.plugins,
    advisoryLock: (key: string) => transaction.advisoryLock(key),
    transaction: <T>(fn: (txContext: ProcedureTransactionContext<Tx>) => Promise<T>) =>
      transaction.transaction(() => fn(face)),
  })
  return face
}

/** The runtime-narrowed context a procedure is handed. See ADR-0086. */
export function procedureContextOf<
  C extends ProcedureHostContext<Tx>,
  Tx extends ProcedureHostTransactionContext,
>(context: C): ProcedureContext<C, Tx> {
  return Object.freeze({
    db: context.db,
    session: context.session,
    storage: context.storage,
    plugins: context.plugins,
    transaction: <T>(fn: (txContext: ProcedureTransactionContext<Tx>) => Promise<T>) =>
      context.transaction((transaction) => fn(transactionContextOf(transaction))),
  })
}
