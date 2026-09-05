import type { Fragment, FieldSelection, ResultOf } from '../query/index.js'
import type { TransactionRegistry } from './transaction-registry.js'

/**
 * Session interface - can be augmented by developers to add custom fields
 *
 * By default, Session is a permissive object that can contain any properties.
 * To get type safety and autocomplete, use module augmentation:
 *
 * @example
 * ```typescript
 * // types/session.d.ts
 * import '@opensaas/stack-core'
 *
 * declare module '@opensaas/stack-core' {
 *   interface Session {
 *     userId: string
 *     email: string
 *     role: 'admin' | 'user'
 *   }
 * }
 * ```
 *
 * After augmentation, session will be fully typed everywhere:
 * - Access control functions
 * - Hooks (resolveInput, validateInput, etc.)
 * - Context object
 *
 * @example
 * ```typescript
 * // With augmentation, this is fully typed:
 * const isAdmin: AccessControl = ({ session }) => {
 *   return session?.role === 'admin'  // ✅ Autocomplete works
 * }
 * ```
 */
export interface Session {
  [key: string]: unknown
}

export type PrismaModelDelegate = {
  findUnique: (args: unknown) => Promise<unknown>
  findFirst: (args: unknown) => Promise<unknown>
  findMany: (args: unknown) => Promise<unknown[]>
  create: (args: unknown) => Promise<unknown>
  update: (args: unknown) => Promise<unknown>
  delete: (args: unknown) => Promise<unknown>
  count: (args?: unknown) => Promise<number>
}

/**
 * The ORM client the engine drives, structurally. Model keys are resolved at
 * runtime from the config's list names, so the client is reached through an
 * index signature and narrowed to {@link OrmModelDelegate} at the point of
 * use rather than typed per model here — the per-model types belong to the
 * generated bundle, which instantiates them from the emitted contract
 * (ADR-0052).
 *
 * `context.prisma` is this type: unsecured, and honest about how little the
 * engine assumes of it.
 */
export interface OrmClient {
  /**
   * Present on a real client and absent on a plain test double. The Write
   * Pipeline probes for it rather than requiring it (ADR-0010).
   */
  $transaction?: unknown
  [modelKey: string]: unknown
}

/** The arguments an ORM operation takes, before the engine lowers them. */
export type OrmOperationArgs = Record<string, unknown>

/** One row as the ORM returns it, before Field Visibility runs over it. */
export type OrmRow = Record<string, unknown>

/**
 * One model's operations on {@link OrmClient}. Reached through
 * {@link isOrmModelDelegate}, never by assuming the key is present.
 */
export interface OrmModelDelegate {
  findUnique: (args: OrmOperationArgs) => Promise<OrmRow | null>
  findFirst: (args?: OrmOperationArgs) => Promise<OrmRow | null>
  findMany: (args?: OrmOperationArgs) => Promise<OrmRow[]>
  create: (args: OrmOperationArgs) => Promise<OrmRow>
  update: (args: OrmOperationArgs) => Promise<OrmRow>
  delete: (args: OrmOperationArgs) => Promise<OrmRow>
  count: (args?: OrmOperationArgs) => Promise<number>
}

// ─────────────────────────────────────────────────────────────
// Augmented find operation types — add `query` overload to findMany / findUnique
// ─────────────────────────────────────────────────────────────

/**
 * Extra query arguments accepted when a `query` Fragment is provided alongside
 * `context.db.<list>.findMany({ query: myFragment, ... })`.
 */
export type FindManyQueryArgs = {
  where?: Record<string, unknown>
  orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
  take?: number
  skip?: number
}

/**
 * Overloaded `findMany` that accepts an optional `query` Fragment.
 *
 * - **With `query`**: builds the Prisma `include` from the fragment, executes the
 *   query, applies access control, and returns records shaped to `ResultOf<fragment>[]`.
 * - **Without `query`**: behaves exactly like the original Prisma `findMany`.
 *
 * TypeScript resolves the return type from the presence (or absence) of `query`
 * in the argument object — no explicit type annotation is needed.
 *
 * @example
 * ```ts
 * // Narrowed return type from fragment
 * const posts = await context.db.post.findMany({
 *   query:   postFragment,
 *   where:   { published: true },
 *   orderBy: { createdAt: 'desc' },
 *   take:    10,
 * })
 * // posts: ResultOf<typeof postFragment>[]
 *
 * // Original Prisma behaviour (no fragment)
 * const posts = await context.db.post.findMany({ where: { published: true } })
 * // posts: Post[]
 * ```
 */
export interface AugmentedFindMany {
  <TItem, TFields extends FieldSelection<TItem>>(
    args: FindManyQueryArgs & { query: Fragment<TItem, TFields> },
  ): Promise<ResultOf<Fragment<TItem, TFields>>[]>
  (args?: OrmOperationArgs): Promise<OrmRow[]>
}

/**
 * Extra query arguments accepted when a `query` Fragment is provided alongside
 * `context.db.<list>.findFirst({ query: myFragment, ... })`.
 */
export type FindFirstQueryArgs = {
  where?: Record<string, unknown>
  orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
  skip?: number
}

/**
 * Overloaded `findFirst` that accepts an optional `query` Fragment.
 *
 * `findFirst` is sugar over the access-controlled `findMany` (`take: 1`), so it
 * applies the exact same query-access checks and access-controlled include
 * building, then returns the first matching record or `null`.
 *
 * - **With `query`**: builds the Prisma `include` from the fragment, executes the
 *   query, applies access control, and returns a record shaped to `ResultOf<fragment>`
 *   or `null`.
 * - **Without `query`**: behaves exactly like the original Prisma `findFirst`.
 *
 * @example
 * ```ts
 * const post = await context.db.post.findFirst({
 *   where:   { published: true },
 *   orderBy: { createdAt: 'desc' },
 *   query:   postFragment,
 * })
 * // post: ResultOf<typeof postFragment> | null
 * ```
 */
export interface AugmentedFindFirst {
  <TItem, TFields extends FieldSelection<TItem>>(
    args: FindFirstQueryArgs & { query: Fragment<TItem, TFields> },
  ): Promise<ResultOf<Fragment<TItem, TFields>> | null>
  (args?: OrmOperationArgs): Promise<OrmRow | null>
}

/**
 * Overloaded `findUnique` that accepts an optional `query` Fragment.
 *
 * - **With `query`**: builds the Prisma `include` from the fragment, executes the
 *   query, applies access control, and returns a record shaped to `ResultOf<fragment>`
 *   or `null`.
 * - **Without `query`**: behaves exactly like the original Prisma `findUnique`.
 *
 * @example
 * ```ts
 * const post = await context.db.post.findUnique({
 *   where: { id: postId },
 *   query: postFragment,
 * })
 * // post: ResultOf<typeof postFragment> | null
 * ```
 */
export interface AugmentedFindUnique {
  <TItem, TFields extends FieldSelection<TItem>>(args: {
    where: Record<string, unknown>
    query: Fragment<TItem, TFields>
  }): Promise<ResultOf<Fragment<TItem, TFields>> | null>
  (args: OrmOperationArgs): Promise<OrmRow | null>
}

/**
 * One list's access-controlled delegate. Every operation runs the list's
 * access rules and hooks, and denial is silent rather than thrown: a
 * single-record terminal returns `null`, a read of many returns `[]`, and
 * `createMany`/`updateMany` return `null` per denied item (Silent failure).
 *
 * Rows are untyped here on purpose: the per-list shapes live in the generated
 * bundle, which instantiates `SecuredList` from the emitted contract
 * (ADR-0052). This is the engine's own view of its output.
 */
export interface AccessControlledDelegate {
  findUnique: AugmentedFindUnique
  findFirst: AugmentedFindFirst
  findMany: AugmentedFindMany
  create: (args: OrmOperationArgs) => Promise<OrmRow | null>
  update: (args: OrmOperationArgs) => Promise<OrmRow | null>
  delete: (args: OrmOperationArgs) => Promise<OrmRow | null>
  count: (args?: OrmOperationArgs) => Promise<number>
  createMany: (args: OrmOperationArgs) => Promise<(OrmRow | null)[]>
  updateMany: (args: OrmOperationArgs) => Promise<(OrmRow | null)[]>
  /** Present only on a list declared `isSingleton` (ADR-0039). */
  get?: (args?: OrmOperationArgs) => Promise<OrmRow | null>
}

/** The keys that mark an ORM client rather than a secured `db` surface. */
type OrmClientMarker =
  | '$connect'
  | '$disconnect'
  | '$transaction'
  | '$extends'
  | '$queryRaw'
  | '$queryRawUnsafe'
  | '$executeRaw'
  | '$executeRawUnsafe'

/**
 * Reported in place of a bare `never` when an ORM client is passed where a
 * secured `db` surface belongs, so the constraint failure names its own cause.
 */
export interface OrmClientIsNotADbSurface {
  readonly 'StackContext takes the generated `db` surface, not the ORM client': never
}

/**
 * The bound on a generated `db` surface. The generated `DB` is an `interface`
 * (ADR-0032), which has no implicit index signature, so this cannot demand a
 * per-member shape. What it can do is refuse what the parameter used to hold:
 * before ADR-0052 `StackContext`'s first argument was the Prisma client, and
 * `StackContext<MyPrismaClient>` would otherwise still compile and silently
 * mean `db: MyPrismaClient`.
 */
export type StackDb<DB = object> = [Extract<keyof DB, OrmClientMarker>] extends [never]
  ? object
  : OrmClientIsNotADbSurface

/**
 * The secured `db` surface, keyed by the camelCase db key of each list. List
 * names come from the config at runtime, so this is an index signature; the
 * generated bundle names each member and gives it its contract-derived type.
 */
export interface AccessControlledDB {
  [dbKey: string]: AccessControlledDelegate
}

export type StorageUtils = {
  uploadFile: (
    providerName: string,
    file: File,
    buffer: Buffer,
    options?: unknown,
  ) => Promise<unknown>

  uploadImage: (
    providerName: string,
    file: File,
    buffer: Buffer,
    options?: unknown,
  ) => Promise<unknown>

  deleteFile: (providerName: string, filename: string) => Promise<void>

  deleteImage: (metadata: unknown) => Promise<void>
}

// Uses `interface` rather than `type` so consumers can extend it via module augmentation.
export interface AccessContext {
  session: Session | null
  prisma: OrmClient
  db: AccessControlledDB
  storage: StorageUtils
  plugins: Record<string, unknown>
  _isSudo: boolean
  /**
   * The resolve chain: the ordered sequence of `resolveOutput` hook
   * `(listKey, fieldKey)` pairs a read has entered on the way to here. A
   * top-level read starts with an empty chain. Each hook invocation is given
   * a NEW context whose chain extends this one by its own pair — the chain is
   * never mutated in place, so concurrent hook invocations (e.g. sibling rows
   * in a to-many relation processed via `Promise.all`) never observe each
   * other's chain. A hook that would re-enter a pair already on its own chain
   * is refused (`ResolveOutputCycleError`) rather than left to recurse
   * forever; a chain longer than `RESOLVE_CHAIN_MAX_LENGTH` is a separate,
   * non-fatal cost limit. See ADR-0023 and the "Resolve chain" glossary entry
   * in CONTEXT.md.
   */
  _resolveOutputChain: readonly { listKey: string; fieldKey: string }[]
  /**
   * Present when this context is JOINED into an enclosing transaction it did
   * not open (ADR-0028, #899) — set by `context.transaction()`, or by the
   * Write Pipeline when it opens the transaction the current write's hooks
   * are rebound into. A write reached through a context carrying this defers
   * its `afterTransaction` bracket to the registry instead of firing it at
   * write time; `undefined` for a top-level context with no owner. Threaded
   * through the same context-rebind path as `plugins`/`_resolveOutputChain`.
   * @internal
   */
  _transactionOwner?: TransactionRegistry
}

export type PrismaFilter<T = Record<string, unknown>> = Partial<Record<keyof T, unknown>>

/**
 * Can return:
 * - boolean: true = allow, false = deny
 * - PrismaFilter: Prisma where clause to filter results
 */
export type AccessControl<T = Record<string, unknown>> = (args: {
  session: Session | null
  item?: T // Present for update/delete operations
  context: AccessContext
}) => boolean | PrismaFilter<T> | Promise<boolean | PrismaFilter<T>>

/**
 * The per-operation argument shapes a `FieldAccessControl` function is called
 * with — the discriminated union `FieldAccessControl` wraps, and the source
 * of truth `FieldAccess`'s individual `read`/`create`/`update` members are
 * picked from (via `Extract`) below. Keeping this as its own named type is
 * what lets both sides reference the exact same three call shapes instead of
 * two independently-maintained descriptions drifting apart.
 */
type FieldAccessControlArgs<TItem, TCreateInput, TUpdateInput> =
  | {
      session: Session | null
      // Field Visibility (phase 2 of the two-phase read) always evaluates
      // `read` rules against an already-fetched row — see
      // `resolveReadableFieldValue` in `field-visibility.ts`, the sole
      // caller of `checkFieldAccess` for this operation. Unlike `create`
      // (where no row exists yet), there is no case where `item` is absent
      // here, so it is required rather than optional.
      item: TItem
      context: AccessContext
      inputData?: undefined
      operation: 'read'
    }
  | {
      session: Session | null
      item?: undefined
      context: AccessContext
      inputData: TCreateInput
      operation: 'create'
    }
  | {
      session: Session | null
      item: TItem
      context: AccessContext
      inputData: TUpdateInput
      operation: 'update'
    }

/**
 * For create/update operations, receives inputData to validate incoming values.
 *
 * Unlike operation-level `AccessControl`, this returns `boolean` only. Field
 * access is a per-field visibility decision, not a row filter — a denied
 * field is removed, never used to scope which rows are returned (see the
 * "Field-level access" glossary entry in `CONTEXT.md`, ADR-0001, and
 * ADR-0030). A rule that needs to depend on the row or the write payload
 * should evaluate the condition itself and return a boolean, e.g.
 * `({ item, session }) => item?.ownerId === session?.userId`. The runtime
 * evaluator (`checkFieldAccess`) enforces this: a rule that somehow returns
 * anything other than `true`/`false` (bypassing this type) throws rather than
 * defaulting to allow.
 *
 * This is the general, all-operations union — useful for a single function
 * reused across more than one of `FieldAccess`'s `read`/`create`/`update`
 * slots, narrowing on `operation` to tell the call shapes apart. A function
 * written for exactly one slot doesn't need to: `FieldAccess` picks each
 * slot's own single-operation shape out of this union (see below), so e.g. a
 * `read`-only rule sees `item` as always present with no narrowing required.
 */
export type FieldAccessControl<
  TItem = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
> = (args: FieldAccessControlArgs<TItem, TCreateInput, TUpdateInput>) => boolean | Promise<boolean>

/**
 * `read` is typed from the single `operation: 'read'` member of
 * `FieldAccessControlArgs`, not the full `FieldAccessControl` union — so a
 * rule written directly for this slot sees `item` as always present (never
 * `TItem | undefined`) with no narrowing, cast, or `any` needed. A function
 * typed as the broader `FieldAccessControl` union remains assignable here
 * (and to `create`/`update`) — accepting more call shapes than the slot
 * requires is a valid substitute, same as anywhere else function parameters
 * are contravariant.
 */
export type FieldAccess<
  TItem = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
> = {
  read?: (
    args: Extract<FieldAccessControlArgs<TItem, TCreateInput, TUpdateInput>, { operation: 'read' }>,
  ) => boolean | Promise<boolean>
  create?: FieldAccessControl<TItem, TCreateInput, TUpdateInput>
  update?: FieldAccessControl<TItem, TCreateInput, TUpdateInput>
}
