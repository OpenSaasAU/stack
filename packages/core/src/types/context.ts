import type { AccessControlledDB, OrmClient, Session, StorageUtils } from '../access/types.js'
import type { ServerActionProps, TransactionOptions } from '../context/index.js'

/**
 * The `db` surface a generated context carries: one member per list, each its
 * own named `SecuredList` interface. The generated `DB` is an `interface`
 * (ADR-0032), which has no implicit index signature, so the bound is
 * `object` — core needs to know nothing more about it than that.
 */
export type StackDb = object

/**
 * The context a hook, an access rule and a plugin service all see: the secured
 * `db`, the session, the raw ORM client and the ambient plumbing. It carries
 * nothing that can start a transaction or change who is asking — that is
 * {@link StackContext}.
 *
 * `.opensaas/types.ts` names it per app:
 *
 * ```ts
 * export interface BaseContext<S extends Session = Session>
 *   extends StackBaseContext<DB, S, PluginServices> {}
 * ```
 *
 * @typeParam DB - the generated `db` surface, one `SecuredList` per list.
 * @typeParam S - the app's session shape.
 * @typeParam P - the app's plugin services, from `.opensaas/plugin-types.ts`.
 */
export interface StackBaseContext<
  DB extends StackDb = AccessControlledDB,
  S extends Session = Session,
  P = Record<string, unknown>,
> {
  db: DB
  session: S | null
  /**
   * The ORM client, unsecured. Reaching a model through it bypasses access
   * control and hooks entirely; it is the documented escape hatch for the
   * cases the secured surface cannot express, and every use should say why.
   */
  prisma: OrmClient
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
 *   extends StackContext<DB, S, PluginServices> {}
 * ```
 */
export interface StackContext<
  DB extends StackDb = AccessControlledDB,
  S extends Session = Session,
  P = Record<string, unknown>,
> extends StackBaseContext<DB, S, P> {
  serverAction: (props: ServerActionProps) => Promise<unknown>
  /**
   * Bypass access control for operations reached through the returned
   * context. Hooks still run. This is not an authorisation — the caller owns
   * the decision to elevate.
   */
  sudo: () => StackContext<DB, S, P>
  /**
   * Substitute the session without changing what access control decides.
   * Preserves the receiver's sudo state.
   */
  withSession: (session: S | null) => StackContext<DB, S, P>
  /**
   * Run `fn` inside ONE interactive transaction. The context handed to `fn`
   * is access-checked and hook-firing exactly as this one is, but persists
   * against the transaction client, so a throw anywhere rolls the whole
   * transaction back (ADR-0012).
   */
  transaction: <T>(
    fn: (txContext: StackTransactionContext<DB, S, P>) => Promise<T>,
    options?: TransactionOptions,
  ) => Promise<T>
}

/**
 * The context inside `context.transaction()`. Identical to
 * {@link StackContext} except that `transaction()` on it joins the enclosing
 * transaction rather than opening a second one (ADR-0028), which is a runtime
 * fact rather than a type difference — the separate name is what lets a
 * signature say which side of the boundary it expects.
 */
export type StackTransactionContext<
  DB extends StackDb = AccessControlledDB,
  S extends Session = Session,
  P = Record<string, unknown>,
> = StackContext<DB, S, P>
