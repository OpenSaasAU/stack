import type { AccessControlledDB, Session, StackDb, StorageUtils } from '../access/types.js'
import type { ServerActionProps } from '../context/index.js'
import type { UnsafeCapableClient, UnsafeSurface } from '../unsafe.js'

export type { StackDb }

/**
 * The context a hook, an access rule and a plugin service all see: the secured
 * `db`, the session, the raw ORM client and the ambient plumbing. It carries
 * nothing that can start a transaction or change who is asking — that is
 * {@link StackContext}.
 *
 * `.opensaas/types.ts` names it per app, keying `TClient` to the app's own
 * Prisma 8 client so `unsafe.sql`/`unsafe.raw` carry the emitted contract's
 * types rather than degrading to `object` (ADR-0052):
 *
 * ```ts
 * export interface BaseContext<S extends Session = Session>
 *   extends StackBaseContext<DB, S, PluginServices, PostgresClient<Contract>> {}
 * ```
 *
 * @typeParam DB - the generated `db` surface, one `SecuredList` per list.
 * @typeParam S - the app's session shape.
 * @typeParam P - the app's plugin services, from `.opensaas/plugin-types.ts`.
 * @typeParam TClient - the Prisma 8 client `unsafe`'s lanes are keyed to.
 *   Defaults to the structural {@link UnsafeCapableClient}, which is why
 *   `context.unsafe.sql`/`.raw` read as `object` unless a caller — the
 *   generated bundle, most often — names the app's own client type here.
 */
export interface StackBaseContext<
  DB extends StackDb<DB> = AccessControlledDB,
  S extends Session = Session,
  P = Record<string, unknown>,
  TClient extends UnsafeCapableClient = UnsafeCapableClient,
> {
  db: DB
  session: S | null
  /**
   * The {@link UnsafeSurface}: Prisma's own query lanes, bypassing access
   * control, Field Visibility, hooks and error normalisation entirely. It is
   * the documented escape hatch for the cases the secured surface cannot
   * express, and every use should say why.
   */
  unsafe: UnsafeSurface<TClient>
  storage: StorageUtils
  plugins: P
  _isSudo: boolean
}

/**
 * The full context a server action and a page component hold: everything
 * {@link StackBaseContext} carries, plus the operations that derive a new
 * context — `sudo()`, `withSession()` and `transaction()`.
 *
 * ```ts
 * export interface Context<S extends Session = Session>
 *   extends StackContext<DB, S, PluginServices, TxDB, PostgresClient<Contract>> {}
 * ```
 */
export interface StackContext<
  DB extends StackDb<DB> = AccessControlledDB,
  S extends Session = Session,
  P = Record<string, unknown>,
  TxDB extends StackDb<TxDB> = DB,
  TClient extends UnsafeCapableClient = UnsafeCapableClient,
> extends StackBaseContext<DB, S, P, TClient> {
  serverAction: (props: ServerActionProps) => Promise<unknown>
  /**
   * Bypass access control for operations reached through the returned
   * context. Hooks still run. This is not an authorisation — the caller owns
   * the decision to elevate.
   */
  sudo: () => StackContext<DB, S, P, TxDB, TClient>
  /**
   * Substitute the session without changing what access control decides.
   * Preserves the receiver's sudo state.
   */
  withSession: (session: S | null) => StackContext<DB, S, P, TxDB, TClient>
  /**
   * Run `fn` inside ONE interactive transaction. The context handed to `fn`
   * is access-checked and hook-firing exactly as this one is, but persists
   * against the transaction client, so a throw anywhere rolls the whole
   * transaction back (ADR-0012).
   *
   * The transaction holds one pooled connection for the whole callback. Work
   * reached through the transaction context — its `db` and its `unsafe` —
   * runs on that connection; work reached through the OUTER context inside
   * the callback asks the pool for a second one, and on a single-connection
   * pool (the dev database's, ADR-0063) waits for one that will not come.
   *
   * The transaction takes the callback and nothing else, and runs at the
   * connection's default isolation level — Read Committed on PostgreSQL. An
   * invariant that a stricter level would have closed is expressed as a lock
   * on the contended row inside the callback — `.forUpdate()`, which is on
   * the transaction-bound `db` and nowhere else (ADR-0042, ADR-0047).
   */
  transaction: <T>(
    fn: (txContext: StackTransactionContext<TxDB, S, P, TxDB, TClient>) => Promise<T>,
  ) => Promise<T>
}

/**
 * The context inside `context.transaction()`: everything {@link StackContext}
 * carries, over the transaction-bound `db` whose reads can take a row lock,
 * plus {@link StackTransactionContext.advisoryLock}. `transaction()` on it
 * joins the enclosing transaction rather than opening a second one (ADR-0028).
 *
 * The two shapes are genuinely different types rather than one name twice, so
 * a signature can say which side of the boundary it expects and `forUpdate()`
 * outside a transaction is a compile error (ADR-0047).
 */
export interface StackTransactionContext<
  DB extends StackDb<DB> = AccessControlledDB,
  S extends Session = Session,
  P = Record<string, unknown>,
  TxDB extends StackDb<TxDB> = DB,
  TClient extends UnsafeCapableClient = UnsafeCapableClient,
> extends StackContext<DB, S, P, TxDB, TClient> {
  /**
   * Take PostgreSQL's transaction-scoped advisory lock on `key`, waiting until
   * it is free. Released when the transaction ends, whichever way it ends.
   *
   * It locks a number rather than rows, so it belongs to no list and there is
   * nothing for the engine to scope — which is why it sits here and not on
   * `db`. The key is hashed with `hashtext()`, matching what Prisma does
   * internally; `hashtext` is 32-bit, so two distinct keys can collide. A
   * collision costs spurious serialisation, never a missed lock (ADR-0047).
   */
  advisoryLock: (key: string) => Promise<void>
  sudo: () => StackTransactionContext<DB, S, P, TxDB, TClient>
  withSession: (session: S | null) => StackTransactionContext<DB, S, P, TxDB, TClient>
}
