import type { OpenSaasConfig, ListConfig, RelationshipField } from '../config/types.js'
import type { Session, AccessContext, AccessControlledDB, StorageUtils } from '../access/index.js'
import { checkAccess } from '../access/index.js'
import { resolveSyntheticReverseRelation } from '../access/engine.js'
import { ValidationError, DatabaseError } from '../hooks/index.js'
import { databaseErrorMessage, normalizeDatabaseError } from '../lib/prisma-errors.js'
import type { OpenedTransaction, OrmClient, OrmRow, TransactionOpener } from '../access/types.js'
import { createSecuredRead, type SecuredQuery } from '../secured/read.js'
import {
  createRowLockLane,
  RowLockUnavailableError,
  unusableRowLockLane,
  type RowLockLane,
} from '../secured/lock.js'
import {
  createUnsafeSurface,
  createUnsafeTransactionSurface,
  unavailableUnsafeSurface,
  type UnsafeCapableClient,
  type UnsafeSurface,
  type UnsafeTransactionScope,
} from '../unsafe.js'
import { ENGINE_FACE, type EngineFaced } from './engine-context.js'
import type { StackContext, StackTransactionContext } from '../types/context.js'
import { getRelationshipOptions } from '../query/relationship-options.js'
import {
  runWritePipeline,
  createWriteStrategy,
  updateWriteStrategy,
  deleteWriteStrategy,
} from './write-pipeline.js'
import { resolveJunctionEdge, ownsForeignKey } from './junction.js'
import { isRelationshipField } from '../fields/index.js'
import { parseListId, type ListIdValue } from '../contract/id-boundary.js'
import { AfterTransactionError } from './transaction-boundary.js'
import { TransactionRegistry } from '../access/transaction-registry.js'
import type { TransactionSettleOutcome } from '../access/transaction-registry.js'

export type ServerActionProps =
  | { listKey: string; action: 'create'; data: Record<string, unknown> }
  | { listKey: string; action: 'update'; id: string; data: Record<string, unknown> }
  | { listKey: string; action: 'delete'; id: string }
  | { listKey: string; action: 'bulkDelete'; ids: string[] }
  // Custom list-specific bulk action (issue #736). `key` names an action
  // declared in the list's `ui.listView.bulkActions`; the client sends only
  // this serialisable `{ key, ids }` and the server-side `handler` (never
  // serialised) is looked up by `key`. Returns a distinct `{ bulkAction,
  // message? }` shape, never `success`, so a redirect-on-`success` wrapper
  // does not hijack it.
  | { listKey: string; action: 'bulkAction'; key: string; ids: string[] }
  // Relationship-table row removal (ADR-0018, #739). `listKey`/`id` target the
  // RELATED row, so the related list's own access control and hooks apply —
  // never the parent's. The other relationship-table actions below share this
  // boundary. `mode: 'disconnect'` unlinks the row by assigning `null` to its
  // back-reference (`field`) without deleting it; `mode: 'delete'` truly
  // deletes the row. Returns a distinct `{ removed }` shape, never `success`,
  // so a UI wrapper that redirects on `success` does not hijack an in-place row
  // removal.
  | {
      listKey: string
      action: 'removeRelated'
      mode: 'disconnect' | 'delete'
      id: string
      field?: string
    }
  // Relationship-table inline cell edit (issue #737); same ADR-0018 boundary
  // as `removeRelated` — `listKey`/`id` target the RELATED row. Returns a
  // distinct `{ updated }` shape, never `success`, so a UI wrapper that
  // redirects on `success` does not hijack an in-place cell edit.
  | {
      listKey: string
      action: 'updateRelated'
      id: string
      field: string
      value: unknown
    }
  // Relationship-table pre-linked create (issue #738); same ADR-0018 boundary
  // as `removeRelated` — `listKey` targets the RELATED list. The back-reference
  // to the parent is set on the SERVER from `field`/`parentId`, never trusted
  // from `data`, so a hostile client cannot re-target the link. Returns a
  // distinct `{ created }` shape, never `success`, so a UI wrapper that
  // redirects on `success` does not hijack an in-place create.
  | {
      listKey: string
      action: 'createRelated'
      data: Record<string, unknown>
      field?: string
      parentId?: string
    }
  // Adding an edge across an explicit junction list (ADR-0050, ADR-0018 as
  // amended). Unlike every other relationship-table action, `listKey` names the
  // PARENT list and `field` its to-many field: the junction list, its
  // back-reference and its far-endpoint field are all resolved from the config
  // on the SERVER, so a client can neither name a junction list of its own
  // choosing nor set a column of the edge row beyond the two endpoints. The
  // create runs under the JUNCTION list's own create access, and the far
  // endpoint goes through `connect`, so an endpoint the caller cannot read is
  // the same answer as one that is not there. Returns a distinct `{ added }`
  // shape, never `success`, so a UI wrapper that redirects on `success` does
  // not hijack an in-place link.
  | {
      listKey: string
      action: 'addRelated'
      field: string
      parentId: string
      targetId: string
    }
  // `listKey`/`id` target the RELATED row, as `removeRelated` does; `field` is
  // the to-one back-reference owning the column, and `parentId` is composed
  // into a `connect` on the SERVER, so the payload carries no relation input of
  // the client's choosing. Returns a distinct `{ linked }` shape, never
  // `success`, so a UI wrapper that redirects on `success` does not hijack it.
  | {
      listKey: string
      action: 'linkRelated'
      id: string
      field: string
      parentId: string
    }
  | {
      listKey: string
      action: 'relationshipOptions'
      field: string
      search?: string
      take?: number
      selectedIds?: string[]
    }

const selectWarnings = new Set<string>()

/**
 * Warn once per (list, operation) when a caller passes `select` to a read op
 * that ignores it. See "Narrowing Reads" in packages/core/CLAUDE.md.
 */
function warnIfSelectIgnored(
  args: { select?: unknown } | undefined,
  listName: string,
  operation: string,
): void {
  if (!args || args.select === undefined) return

  const key = `${listName}.${operation}`
  if (selectWarnings.has(key)) return
  selectWarnings.add(key)

  console.warn(
    `[@opensaas/stack-core] \`select\` is ignored by context.db.${listName}.${operation}() ` +
      `and the full (access-filtered) record is returned. ` +
      `Narrow a read with \`include\`, or with \`.select()\` on the secured surface, instead. ` +
      `See https://stack.opensaas.au/docs/concepts/queries`,
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function isSingletonList(listConfig: ListConfig<any>): boolean {
  return !!listConfig.isSingleton
}

type BackReferenceClassification =
  { kind: 'owning'; field: RelationshipField } | { kind: 'nonOwning' } | { kind: 'notRelationship' }

/**
 * Whether `fieldName` on `listKey` owns a foreign-key column — the property
 * `removeRelated`/`createRelated`/`linkRelated` actually need, rather than
 * `many`, which is only a proxy for it: a non-owning to-one (the inverse half
 * of a one-to-one) has `many` falsy exactly like an owning one, and a
 * synthetic `from_<List>_<field>` back-relation is never declared, so it is
 * never itself in `listConfig.fields` (#1442).
 */
function classifyBackReference(
  listKey: string,
  fieldName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  config: OpenSaasConfig,
): BackReferenceClassification {
  const field = listConfig.fields[fieldName]
  if (isRelationshipField(field)) {
    return ownsForeignKey(config, listKey, fieldName, field)
      ? { kind: 'owning', field }
      : { kind: 'nonOwning' }
  }
  return resolveSyntheticReverseRelation(fieldName, listKey, config) !== null
    ? { kind: 'nonOwning' }
    : { kind: 'notRelationship' }
}

/**
 * `update` and `delete` target a row by its identity: the engine lowers `id`
 * alone into the write's predicate, so a `where` naming anything else — a
 * secondary unique column included — selects nothing. That is a caller-shape
 * error, not an access denial, so it THROWS rather than returning the
 * denied-or-gone `null`.
 *
 * `ListIdentityWhere` makes it a compile error for a typed caller; this is the
 * runtime half, for a payload that reached the engine untyped.
 */
function assertIdentityWhere(
  where: Record<string, unknown> | undefined,
  listName: string,
  terminal: 'update' | 'delete',
): asserts where is { id: string | number } {
  const keys = where ? Object.keys(where) : []
  const id = where?.id
  if (keys.length === 1 && keys[0] === 'id' && (typeof id === 'string' || typeof id === 'number')) {
    return
  }

  const received =
    keys.length === 0
      ? '{}'
      : keys.length === 1 && keys[0] === 'id'
        ? `{ id: ${id === null ? 'null' : typeof id} }`
        : `{ ${keys.join(', ')} }`

  throw new ValidationError(
    [
      `${terminal} on "${listName}" requires \`where: { id }\` — a row is written by its ` +
        `identity, and no other column selects one. Received: ${received}. Find the row first ` +
        `(\`where(…).first()\`) and write it by its \`id\`.`,
    ],
    {},
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function shouldAutoCreate(listConfig: ListConfig<any>): boolean {
  if (!listConfig.isSingleton) return false
  if (typeof listConfig.isSingleton === 'boolean') return true
  return listConfig.isSingleton.autoCreate !== false
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function getDefaultData(listConfig: ListConfig<any>): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  for (const [fieldKey, fieldConfig] of Object.entries(listConfig.fields)) {
    if (fieldConfig.virtual) continue

    if (fieldKey === 'id' || fieldKey === 'createdAt' || fieldKey === 'updatedAt') continue

    if ('defaultValue' in fieldConfig && fieldConfig.defaultValue !== undefined) {
      data[fieldKey] = fieldConfig.defaultValue
    }
  }

  return data
}

/**
 * Minimal shape of a client that can open an interactive transaction by
 * exposing `$transaction`. A transaction client (the `tx` handed to the
 * callback) does NOT expose it, which is how a nested `transaction()` detects
 * it is already inside one and joins it rather than opening another.
 *
 * It is tried before {@link TransactionOpener}; on a Prisma 8 client this
 * member is absent and the opener runs instead.
 */
interface TransactionCapable {
  $transaction?: (fn: (tx: OrmClient) => Promise<unknown>) => Promise<unknown>
}

/**
 * Thrown when `context.transaction()` can neither open a transaction nor join
 * one.
 *
 * The call's whole contract is that its callback's writes commit or roll back
 * together, so running the callback anyway would hand back that guarantee
 * without holding it. A context reaches this only when it was assembled
 * without the Prisma 8 client the opener is derived from — a hand-built ORM
 * double, or `getContext` called without its `client` argument.
 */
export class TransactionUnavailableError extends Error {
  constructor() {
    super(
      `context.transaction() has no client to open a transaction on and no enclosing ` +
        `transaction to join, so its callback's writes would commit one by one with no ` +
        `rollback between them. Build the context over the Prisma 8 client — \`getContext\`'s ` +
        `\`client\` argument, which the generated context passes — rather than over an ORM ` +
        `handle alone.`,
    )
    this.name = 'TransactionUnavailableError'
  }
}

/**
 * Thrown when the transaction's own collections cannot be resolved for every
 * list the config declares, after the client's could be.
 *
 * The two roots have the same shape, so this is an ORM surprise rather than a
 * wiring fault — and the alternative to reporting it is binding `db` to a
 * half-built handle whose writes land outside the open transaction.
 */
export class TransactionOrmHandleError extends Error {
  constructor() {
    super(
      `The stack opened a transaction whose ORM collections could not be resolved, though the ` +
        `client's could. The engine's handle must be bound to the transaction or its writes ` +
        `would commit outside it, so the transaction is rolled back rather than run unbound.`,
    )
    this.name = 'TransactionOrmHandleError'
  }
}

const DEFAULT_NAMESPACE = 'public'

/**
 * A Prisma 8 client's `orm` root — the namespace-keyed collection tree the
 * engine's handle is resolved from. Structural rather than the generated
 * client's own type, so a caller holding only the `orm` lane (a transaction
 * scope, the test harness) fits it too.
 */
export type OrmRoot = UnsafeCapableClient['orm']

function reachable(container: unknown, key: string): unknown {
  if (container === null || (typeof container !== 'object' && typeof container !== 'function')) {
    return undefined
  }
  return Reflect.get(container, key)
}

type OrmHandleResolution =
  | { readonly handle: OrmClient; readonly unresolved?: undefined }
  | { readonly handle?: undefined; readonly unresolved: { list: string; namespace: string } }

/**
 * The engine's ORM handle, resolved off a Prisma 8 `orm` root.
 *
 * A Prisma 8 client exposes its collections at `orm.<namespace>.<Model>` while
 * the engine reaches a model by db key, so a handle bound to a transaction has
 * to be rebuilt rather than reused — the same reconciliation the test harness
 * performs, over the config's lists rather than the derived contract's models
 * (both spell the model name as the list key and the namespace as `db.schema`).
 *
 * Reports the first list it cannot reach rather than a bare failure, so a
 * caller can name the collection that is missing instead of every list the
 * config declares.
 *
 * Reads go through `Reflect.get`: `orm` and its namespaces are Proxies with a
 * `get` trap and no `has` trap, so `key in namespace` reports false for a
 * collection that is right there.
 */
function ormHandleFor(config: OpenSaasConfig, orm: OrmRoot): OrmHandleResolution {
  const models: Record<string, unknown> = {}
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    const namespaceName = listConfig.db?.schema ?? DEFAULT_NAMESPACE
    const namespace = reachable(orm, namespaceName)
    const collection = reachable(namespace, listKey)
    if (
      collection === null ||
      (typeof collection !== 'object' && typeof collection !== 'function')
    ) {
      return { unresolved: { list: listKey, namespace: namespaceName } }
    }
    models[listKey] = collection
  }
  return { handle: models }
}

/**
 * Thrown when a client's collections cannot be resolved for every list the
 * config declares. The engine reaches every model through the handle, so a
 * context built over a partial one refuses each unresolved list's operations
 * with `OrmModelMissingError` at its own call site instead of here.
 */
export class OrmHandleUnresolvableError extends Error {
  constructor(
    readonly list: string,
    readonly namespace: string,
  ) {
    super(
      `The ORM client exposes no collection "${list}" in namespace "${namespace}", which this ` +
        `config declares as a list. Re-run \`opensaas generate\` so the emitted contract matches ` +
        `the config.`,
    )
    this.name = 'OrmHandleUnresolvableError'
  }
}

/**
 * The engine's ORM handle for a Prisma 8 client's `orm` root — what
 * {@link getContext} takes as its `ormHandle`. A caller that has a client
 * rather than a handle resolves it here, so the generated context, the test
 * harness and `context.transaction()` all hand the engine the same shape.
 *
 * @throws {OrmHandleUnresolvableError} when any declared list is unreachable.
 */
export function requireOrmHandle(config: OpenSaasConfig, orm: OrmRoot): OrmClient {
  const { handle, unresolved } = ormHandleFor(config, orm)
  if (handle === undefined) {
    throw new OrmHandleUnresolvableError(unresolved.list, unresolved.namespace)
  }
  return handle
}

/**
 * The transaction opener for a context over `client`, or `undefined` when this
 * context cannot open one: no Prisma 8 client, or a context already bound to an
 * enclosing transaction (`unsafeTransaction`). A write reached through a
 * context with no opener runs directly against the handle it was given, joining
 * whatever transaction is already open around it (ADR-0028).
 *
 * A client whose collections do not cover the config throws here rather than
 * yielding no opener: an unresolvable handle downgrades every write to
 * non-transactional, which is the loss of the rollback guarantee this opener
 * exists to provide.
 */
function transactionOpenerFor(
  config: OpenSaasConfig,
  client: UnsafeCapableClient | undefined,
  unsafeTransaction: UnsafeTransactionScope | undefined,
): TransactionOpener | undefined {
  if (client === undefined || unsafeTransaction !== undefined) return undefined
  requireOrmHandle(config, client.orm)
  return <T>(run: (opened: OpenedTransaction) => Promise<T>): Promise<T> =>
    client.transaction(async (tx) => {
      const { handle } = ormHandleFor(config, tx.orm)
      if (handle === undefined) throw new TransactionOrmHandleError()
      return await run({ ormHandle: handle, unsafe: tx })
    })
}

/**
 * Drain a `context.transaction()` owner's deferral registry once its callback
 * (and any real underlying transaction) has settled (ADR-0028). A transaction/
 * callback error always wins — compensators still all run, but their errors
 * are discarded in favor of re-surfacing the original, matching the Write
 * Pipeline's `txError` precedence — otherwise any deferred `afterTransaction`
 * errors reject with {@link AfterTransactionError} even though the callback
 * succeeded and the transaction committed.
 *
 * The settle is the second normalisation site (ADR-0042). PostgreSQL raises
 * some failures at `COMMIT`, after every terminal in the callback has already
 * returned — a `23505` on a `DEFERRABLE INITIALLY DEFERRED` constraint, by
 * design — so the error the owner observes is normalised here, BEFORE the
 * deferred-hook flush, which keeps ADR-0028's precedence rule operating on a
 * normalised value.
 */
async function settleTransactionOwner<T>(
  settled: Promise<T>,
  registry: TransactionRegistry,
  config: OpenSaasConfig,
): Promise<T> {
  const errors: unknown[] = []
  let result: T
  try {
    result = await settled
  } catch (raised) {
    const err = normalizeDatabaseError(raised, config)
    const outcome: TransactionSettleOutcome = { status: 'rolled-back', error: err }
    await registry.drain(outcome, errors)
    throw err
  }
  await registry.drain({ status: 'committed' }, errors)
  if (errors.length > 0) {
    throw new AfterTransactionError(errors)
  }
  return result
}

/**
 * The transaction-bound face of a context: everything it already carries, plus
 * `advisoryLock`, and with `sudo()`, `withSession()` and `transaction()`
 * answering in the same face rather than dropping back to the plain one
 * (ADR-0047).
 *
 * A wrapper rather than a second `getContext` branch, because the difference
 * between the two shapes is exactly these four members — `db` is the same
 * object, already built over the transaction's own collections and its lock
 * lane. The nested `transaction()` runs the callback directly, which is what
 * the wrapped context's own `transaction` does inside an owned transaction
 * (ADR-0028); it is spelled here so the callback is handed this face.
 */
function transactionFace(
  base: StackContext<AccessControlledDB>,
  lock: RowLockLane | undefined,
): StackTransactionContext<AccessControlledDB> {
  const face: StackTransactionContext<AccessControlledDB> = {
    ...base,
    advisoryLock: async (key: string): Promise<void> => {
      if (lock === undefined) throw new RowLockUnavailableError('advisoryLock()')
      await lock.advisory(key)
    },
    sudo: () => transactionFace(base.sudo(), lock),
    withSession: (session) => transactionFace(base.withSession(session), lock),
    transaction: <T>(
      fn: (txContext: StackTransactionContext<AccessControlledDB>) => Promise<T>,
    ): Promise<T> => fn(face),
  }
  return face
}

// A database failure reaches the client as the stack's own message (ADR-0042),
// so the driver's diagnostic text — carried on `cause` — reaches no channel at
// all unless it is logged here. Deleting this closes the operator's only view
// of a production database failure.
function logDatabaseFailure(error: unknown, listKey: string, action: string): void {
  if (!(error instanceof DatabaseError)) return
  console.error(`Database error on "${action}" for list "${listKey}":`, error.cause ?? error)
}

/**
 * The lock lane a context carries, present only inside a transaction — which
 * is what makes `forUpdate()` answerable there and a refusal everywhere else.
 * The raw tag comes from the client because Prisma's transaction context
 * carries none, and the executor from the transaction because the lock has to
 * be the transaction's (ADR-0047, ADR-0062).
 *
 * Inside a transaction whose client cannot compose the statement the seat is
 * filled by a refusing lane rather than left empty, so `undefined` keeps
 * meaning exactly one thing: there is no transaction.
 */
function rowLockSeat(
  client: UnsafeCapableClient | undefined,
  transaction: UnsafeTransactionScope | undefined,
): RowLockLane | undefined {
  if (client === undefined || transaction === undefined) return undefined
  return createRowLockLane(client.raw, client.contract, transaction) ?? unusableRowLockLane()
}

export function getContext<TConfig extends OpenSaasConfig>(
  config: TConfig,
  ormHandle: OrmClient,
  session: Session | null,
  storage?: StorageUtils,
  _isSudo: boolean = false,
  // Internal: when rebuilding the context against a transaction client, reuse the
  // already-initialised plugin services rather than re-running plugin runtimes.
  _sharedPlugins?: Record<string, unknown>,
  // Internal (ADR-0028, #899): when rebuilding the context for a transaction
  // owner's callback body, carry the deferral registry so writes reached
  // through this context join it instead of firing afterTransaction eagerly.
  _transactionOwner?: TransactionRegistry,
  // The Prisma 8 client the Unsafe surface is built over. Omitted by a caller
  // that assembles a context from a hand-built ORM double, whose
  // `context.unsafe` then refuses rather than being typed as absent.
  client?: UnsafeCapableClient,
  // Internal: the transaction the Unsafe surface binds its executors to, set
  // when rebuilding the context inside `transaction()` (ADR-0056).
  _unsafeTransaction?: UnsafeTransactionScope,
): StackContext<AccessControlledDB> {
  // Broad type to allow dynamic model access; populated by populateDbDelegate below.
  const db: Record<string, unknown> = {}

  const openTransaction = transactionOpenerFor(config, client, _unsafeTransaction)

  const lock = rowLockSeat(client, _unsafeTransaction)

  const unsafe: UnsafeSurface =
    client === undefined
      ? unavailableUnsafeSurface()
      : _unsafeTransaction === undefined
        ? createUnsafeSurface(client)
        : createUnsafeTransactionSurface(client, _unsafeTransaction)

  const context: AccessContext = {
    session,
    ormHandle,
    db: db as AccessControlledDB,
    storage: storage ?? {
      uploadFile: async () => {
        throw new Error(
          'No storage providers configured. Add storage providers to your opensaas.config.ts',
        )
      },
      uploadImage: async () => {
        throw new Error(
          'No storage providers configured. Add storage providers to your opensaas.config.ts',
        )
      },
      deleteFile: async () => {
        throw new Error(
          'No storage providers configured. Add storage providers to your opensaas.config.ts',
        )
      },
      deleteImage: async () => {
        throw new Error(
          'No storage providers configured. Add storage providers to your opensaas.config.ts',
        )
      },
    },
    // Reuse already-initialised plugin services when rebinding to a transaction
    // client, otherwise start empty and populate via plugin runtimes below.
    plugins: _sharedPlugins ?? {},
    _isSudo,
    _resolveOutputChain: [],
    _transactionOwner,
    _transactionOpener: openTransaction,
    _rowLock: lock,
    _config: config,
  }

  populateDbDelegate(db, config, ormHandle, context, lock)

  // Skipped when reusing shared plugins (transaction rebind) so runtimes — and
  // any side effects they carry — run exactly once per top-level context.
  if (!_sharedPlugins) {
    const pluginsToExecute = config._plugins || config.plugins || []
    for (const plugin of pluginsToExecute) {
      if (plugin.runtime) {
        try {
          // Passed as a plain second argument rather than a method on
          // `context` itself — see the `sudo` param doc on `Plugin['runtime']`.
          context.plugins[plugin.name] = plugin.runtime(context, sudo)
        } catch (error) {
          console.error(`Error executing runtime for plugin "${plugin.name}":`, error)
        }
      }
    }
  }

  // Returns a result object instead of throwing — required for server actions
  // to work in Next.js production builds.
  async function serverAction(props: ServerActionProps): Promise<
    | { success: true; data: unknown }
    | { success: false; error: string; fieldErrors?: Record<string, string> }
    // The distinct shapes below (never `success`) mirror the ServerActionProps
    // variants above — see their comments for the redirect-on-`success`
    // footgun each one avoids.
    | { deleted: number; total: number }
    | { removed: boolean; error?: string }
    | { created: boolean; id?: string; error?: string; fieldErrors?: Record<string, string> }
    | { bulkAction: true; message?: string }
    | { bulkAction: false; error: string }
    | { updated: boolean; error?: string; fieldErrors?: Record<string, string> }
    | { added: boolean; id?: string; error?: string; fieldErrors?: Record<string, string> }
    | { linked: boolean; error?: string; fieldErrors?: Record<string, string> }
  > {
    if (!Object.hasOwn(config.lists, props.listKey)) {
      return {
        success: false,
        error: `List "${props.listKey}" not found in configuration`,
      }
    }
    const listConfig = config.lists[props.listKey]

    const model = db[props.listKey] as {
      create: (args: { data: Record<string, unknown> }) => Promise<unknown>
      update: (args: {
        where: { id: ListIdValue }
        data: Record<string, unknown>
      }) => Promise<unknown>
      delete: (args: { where: { id: ListIdValue } }) => Promise<unknown>
    }

    // Every id here arrived as a string on the wire, and the id type is per
    // list (ADR-0048), so each one is parsed through the one boundary coercion
    // before it reaches the ORM. `null` is an id the list's key type cannot
    // hold — refused here rather than sent on as a `NaN` or a Postgres type
    // error.
    const parseId = (listKey: string, raw: unknown): ListIdValue | null => {
      const parsed = parseListId(config, listKey, raw)
      return parsed.ok ? parsed.value : null
    }

    // Bulk delete: remove each id row-by-row through the secured context,
    // honouring Silent failure — a denied (or missing) row returns `null` and is
    // simply not counted. Returns "N of M" so partial denials are visible without
    // revealing which rows were denied or why. One row's error never aborts the
    // rest.
    if (props.action === 'bulkDelete') {
      let deleted = 0
      for (const raw of props.ids) {
        const id = parseId(props.listKey, raw)
        if (id === null) continue
        try {
          const result = await model.delete({ where: { id } })
          if (result !== null && result !== undefined) deleted++
        } catch {
          // Skip this row (e.g. a DB constraint error); it is not counted.
        }
      }
      return { deleted, total: props.ids.length }
    }

    // Custom Bulk action (issue #736). Look the declared action up by `key` and
    // run its server-side `handler` over the selected ids with THIS secured
    // context — the handler does its own row-by-row work through `context.db`,
    // so per-id access control and hooks apply and denials stay Silent. The
    // `hasAccess` visibility gate (if any) is re-checked here so a hidden action
    // can never be invoked by a hand-crafted request; the client only ever sends
    // the serialisable `{ key, ids }`, never the handler itself.
    if (props.action === 'bulkAction') {
      const bulkActions = listConfig.ui?.listView?.bulkActions ?? []
      const action = bulkActions.find((a) => a.key === props.key)
      if (!action) {
        return {
          bulkAction: false,
          error: `Bulk action "${props.key}" not found on list "${props.listKey}"`,
        }
      }
      if (action.hasAccess) {
        const allowed = await action.hasAccess({
          session: context.session,
          context,
          listKey: props.listKey,
        })
        if (!allowed) {
          return { bulkAction: false, error: 'Access denied' }
        }
      }
      try {
        const result = await action.handler({
          listKey: props.listKey,
          ids: props.ids,
          context,
        })
        return { bulkAction: true, message: result?.message }
      } catch (error) {
        if (error instanceof ValidationError || error instanceof DatabaseError) {
          logDatabaseFailure(error, props.listKey, props.action)
          return { bulkAction: false, error: error.message }
        }
        const dbError = databaseErrorMessage(error, config)
        // A normalised database error carries a user-safe, translated message.
        if (dbError instanceof DatabaseError) {
          logDatabaseFailure(dbError, props.listKey, props.action)
          return { bulkAction: false, error: dbError.message }
        }
        // Anything else is an unexpected handler bug whose raw `.message` could
        // leak internal detail to the client — log it server-side and return a
        // generic client-facing message instead.
        console.error(`Bulk action "${props.key}" on list "${props.listKey}" failed:`, error)
        return { bulkAction: false, error: 'Action failed' }
      }
    }

    // Runs on the RELATED row (ADR-0018 boundary — see ServerActionProps above).
    // Honours Silent failure: an access-denied operation returns `null`, which
    // becomes `{ removed: false }` with a generic reason — never leaking whether
    // the row was denied or absent.
    if (props.action === 'removeRelated') {
      const relatedId = parseId(props.listKey, props.id)
      if (relatedId === null) return { removed: false, error: 'Access denied or operation failed' }
      try {
        let result: unknown = null
        if (props.mode === 'delete') {
          result = await model.delete({ where: { id: relatedId } })
        } else {
          // Disconnect: an UPDATE on the related list nulling its back-reference,
          // never a delete — the row itself survives. A non-owning back-reference
          // (a to-many, the inverse half of a one-to-one, or a synthetic
          // `from_<List>_<field>` back-relation) owns no foreign key to null, so
          // removing that edge is deleting the junction row under its own delete
          // access (`mode: 'delete'`), or nulling the field on the list that DOES
          // own the column, not an update here (ADR-0050, ADR-0018 as amended).
          if (!props.field) {
            return { removed: false, error: 'Missing back-reference field for disconnect' }
          }
          const backRef = classifyBackReference(props.listKey, props.field, listConfig, config)
          if (backRef.kind === 'notRelationship') {
            return {
              removed: false,
              error: `Field "${props.field}" on list "${props.listKey}" is not a relationship field`,
            }
          }
          if (backRef.kind === 'nonOwning') {
            return {
              removed: false,
              error:
                `Cannot unlink through "${props.field}": a non-owning back-reference owns no ` +
                `foreign key to clear. Remove the row itself instead.`,
            }
          }
          result = await model.update({
            where: { id: relatedId },
            data: { [props.field]: null },
          })
        }
        if (result === null || result === undefined) {
          return { removed: false, error: 'Access denied or operation failed' }
        }
        return { removed: true }
      } catch (error) {
        if (error instanceof ValidationError || error instanceof DatabaseError) {
          logDatabaseFailure(error, props.listKey, props.action)
          return { removed: false, error: error.message }
        }
        const dbError = databaseErrorMessage(error, config)
        logDatabaseFailure(dbError, props.listKey, props.action)
        return { removed: false, error: dbError.message }
      }
    }

    // Runs on the RELATED list (ADR-0018 boundary — see ServerActionProps above).
    // The back-reference to the parent is set here from `field`/`parentId`, so
    // the client can never re-target the link. Only the foreign-key-owning side
    // owns a column to hold it; a non-owning one is refused below. Honours
    // Silent failure: an access-denied create returns `null`, surfaced as
    // `{ created: false }` with a generic reason (no denied-vs-absent leak).
    if (props.action === 'createRelated') {
      try {
        // Defensive guard (hardening; unreachable from the drawer, which always
        // mounts on a valid back-reference and sends BOTH field and parentId).
        // A lone field/parentId is a malformed direct call — reject it rather
        // than silently skip back-reference injection and let a client-supplied
        // data[field] slip through unguarded to the create.
        if (!!props.field !== !!props.parentId) {
          return {
            created: false,
            error: 'createRelated requires both field and parentId, or neither',
          }
        }
        const data: Record<string, unknown> = { ...props.data }
        if (props.field && props.parentId) {
          const backRef = classifyBackReference(props.listKey, props.field, listConfig, config)
          // The back-reference must name a relationship field on this list; a
          // non-relationship field would otherwise receive a nonsensical
          // { connect } value. Also hardening — the drawer only ever passes a
          // real relationship back-reference here.
          if (backRef.kind === 'notRelationship') {
            return {
              created: false,
              error: `Field "${props.field}" on list "${props.listKey}" is not a relationship field`,
            }
          }
          // A non-owning back-reference (a to-many, the inverse half of a
          // one-to-one, or a synthetic back-relation) owns no foreign key, so
          // there is no column on the row being created for the parent to go
          // in (ADR-0050).
          if (backRef.kind === 'nonOwning') {
            return {
              created: false,
              error:
                `Cannot preset "${props.field}": a non-owning back-reference owns no foreign key. ` +
                `Link the parent from the side that holds the column.`,
            }
          }
          const parentId = parseId(backRef.field.ref.split('.')[0], props.parentId)
          if (parentId === null) {
            return { created: false, error: 'Access denied or operation failed' }
          }
          // The back-reference is set on the SERVER from the trusted parentId,
          // OVERWRITING any client-supplied data[field] spread in above, so a
          // hostile client can never re-target the link.
          data[props.field] = { connect: { id: parentId } }
        }
        const result = await model.create({ data })
        if (result === null || result === undefined) {
          return { created: false, error: 'Access denied or operation failed' }
        }
        const id =
          typeof result === 'object' && result !== null && 'id' in result
            ? String((result as { id: unknown }).id)
            : undefined
        return { created: true, id }
      } catch (error) {
        if (error instanceof ValidationError || error instanceof DatabaseError) {
          logDatabaseFailure(error, props.listKey, props.action)
          return { created: false, error: error.message, fieldErrors: error.fieldErrors }
        }
        const dbError = databaseErrorMessage(error, config)
        logDatabaseFailure(dbError, props.listKey, props.action)
        return {
          created: false,
          error: dbError.message,
          fieldErrors: dbError instanceof DatabaseError ? dbError.fieldErrors : undefined,
        }
      }
    }

    // Adds one edge across an explicit junction list by creating the junction
    // row (ADR-0050). Both foreign keys are `connect`s the SERVER composes from
    // the resolved edge, so the payload carries no column of the client's
    // choosing, and the reachability query behind each `connect` keeps an
    // endpoint the caller cannot read indistinguishable from one that is not
    // there. Honours Silent failure: a denied create on the junction list — the
    // list this write is evaluated against, never the parent's — returns
    // `null`, surfaced as `{ added: false }` with the same generic reason an
    // unreachable endpoint gets.
    if (props.action === 'addRelated') {
      const edge = resolveJunctionEdge(config, props.listKey, props.field)
      if (!edge) {
        return {
          added: false,
          error:
            `Cannot link through "${props.listKey}.${props.field}": it is not an edge across an ` +
            `explicit junction list. Write the related row against its own list instead.`,
        }
      }
      const parentId = parseId(props.listKey, props.parentId)
      const targetId = parseId(edge.targetListKey, props.targetId)
      if (parentId === null || targetId === null) {
        return { added: false, error: 'Access denied or operation failed' }
      }
      const junction = db[edge.junctionListKey] as {
        create: (args: { data: Record<string, unknown> }) => Promise<unknown>
      }
      try {
        const result = await junction.create({
          data: {
            [edge.backReferenceField]: { connect: { id: parentId } },
            [edge.targetField]: { connect: { id: targetId } },
          },
        })
        if (result === null || result === undefined) {
          return { added: false, error: 'Access denied or operation failed' }
        }
        const id =
          typeof result === 'object' && result !== null && 'id' in result
            ? String((result as { id: unknown }).id)
            : undefined
        return { added: true, id }
      } catch (error) {
        if (error instanceof ValidationError || error instanceof DatabaseError) {
          logDatabaseFailure(error, edge.junctionListKey, props.action)
          return { added: false, error: error.message, fieldErrors: error.fieldErrors }
        }
        const dbError = databaseErrorMessage(error, config)
        logDatabaseFailure(dbError, edge.junctionListKey, props.action)
        return {
          added: false,
          error: dbError.message,
          fieldErrors: dbError instanceof DatabaseError ? dbError.fieldErrors : undefined,
        }
      }
    }

    // The write runs on the RELATED list, so that list's own update access and
    // hooks decide it, never the parent's. Only the foreign-key-owning side
    // owns a column to hold the link. Honours Silent failure: an access-denied
    // update returns `null`, surfaced as `{ linked: false }` with a generic
    // reason.
    if (props.action === 'linkRelated') {
      const backRef = classifyBackReference(props.listKey, props.field, listConfig, config)
      if (backRef.kind === 'notRelationship') {
        return {
          linked: false,
          error: `Field "${props.field}" on list "${props.listKey}" is not a relationship field`,
        }
      }
      if (backRef.kind === 'nonOwning') {
        return {
          linked: false,
          error:
            `Cannot link through "${props.field}": a non-owning back-reference owns no foreign key. ` +
            `Link the parent from the side that holds the column.`,
        }
      }
      const relatedId = parseId(props.listKey, props.id)
      const parentId = parseId(backRef.field.ref.split('.')[0], props.parentId)
      if (relatedId === null || parentId === null) {
        return { linked: false, error: 'Access denied or operation failed' }
      }
      try {
        const result = await model.update({
          where: { id: relatedId },
          data: { [props.field]: { connect: { id: parentId } } },
        })
        if (result === null || result === undefined) {
          return { linked: false, error: 'Access denied or operation failed' }
        }
        return { linked: true }
      } catch (error) {
        if (error instanceof ValidationError || error instanceof DatabaseError) {
          logDatabaseFailure(error, props.listKey, props.action)
          return { linked: false, error: error.message, fieldErrors: error.fieldErrors }
        }
        const dbError = databaseErrorMessage(error, config)
        logDatabaseFailure(dbError, props.listKey, props.action)
        return {
          linked: false,
          error: dbError.message,
          fieldErrors: dbError instanceof DatabaseError ? dbError.fieldErrors : undefined,
        }
      }
    }

    // Updates ONE scalar field on the RELATED row (ADR-0018 boundary — see
    // ServerActionProps above). Honours Silent failure: an access-denied update
    // returns `null`, surfaced as `{ updated: false }` with a generic reason (no
    // denied-vs-absent leak); a validation/db error surfaces its message and
    // fieldErrors so the cell can revert with a reason and show an inline error.
    if (props.action === 'updateRelated') {
      const relatedId = parseId(props.listKey, props.id)
      if (relatedId === null) return { updated: false, error: 'Access denied or operation failed' }
      try {
        const result = await model.update({
          where: { id: relatedId },
          data: { [props.field]: props.value },
        })
        if (result === null || result === undefined) {
          return { updated: false, error: 'Access denied or operation failed' }
        }
        return { updated: true }
      } catch (error) {
        if (error instanceof ValidationError || error instanceof DatabaseError) {
          logDatabaseFailure(error, props.listKey, props.action)
          return { updated: false, error: error.message, fieldErrors: error.fieldErrors }
        }
        const dbError = databaseErrorMessage(error, config)
        logDatabaseFailure(dbError, props.listKey, props.action)
        return {
          updated: false,
          error: dbError.message,
          fieldErrors: dbError instanceof DatabaseError ? dbError.fieldErrors : undefined,
        }
      }
    }

    try {
      if (props.action === 'relationshipOptions') {
        const fieldConfig = listConfig.fields[props.field] as
          { type?: string; ref?: string } | undefined
        if (!fieldConfig || fieldConfig.type !== 'relationship' || !fieldConfig.ref) {
          return {
            success: false,
            error: `Field "${props.field}" on list "${props.listKey}" is not a relationship field`,
          }
        }

        const relatedListKey = fieldConfig.ref.split('.')[0]
        const options = await getRelationshipOptions(context, config, relatedListKey, {
          search: props.search,
          take: props.take,
          selectedIds: props.selectedIds,
        })

        return { success: true, data: options }
      }

      let result: unknown = null

      if (props.action === 'create') {
        result = await model.create({ data: props.data })
      } else if (props.action === 'update' || props.action === 'delete') {
        const id = parseId(props.listKey, props.id)
        if (id === null) {
          return { success: false, error: 'Access denied or operation failed' }
        }
        result =
          props.action === 'update'
            ? await model.update({ where: { id }, data: props.data })
            : await model.delete({ where: { id } })
      }

      // Check for access denial (null return from access-controlled operations)
      if (result === null) {
        return {
          success: false,
          error: 'Access denied or operation failed',
        }
      }

      return {
        success: true,
        data: result,
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        return {
          success: false,
          error: error.message,
          fieldErrors: error.fieldErrors,
        }
      }

      if (error instanceof DatabaseError) {
        logDatabaseFailure(error, props.listKey, props.action)
        return {
          success: false,
          error: error.message,
          fieldErrors: error.fieldErrors,
        }
      }

      const dbError = databaseErrorMessage(error, config)
      if (dbError instanceof DatabaseError) {
        logDatabaseFailure(dbError, props.listKey, props.action)
        return {
          success: false,
          error: dbError.message,
          fieldErrors: dbError.fieldErrors,
        }
      }

      return {
        success: false,
        error: dbError.message,
      }
    }
  }

  // Bypasses access control; hooks and validation still run.
  function sudo(): StackContext<AccessControlledDB> {
    return getContext(
      config,
      ormHandle,
      session,
      context.storage,
      true,
      undefined,
      // ADR-0028: a sudo write issued from inside an owned transaction (e.g.
      // `tx.sudo().db.x.create()`) must still defer to that owner.
      context._transactionOwner,
      client,
      _unsafeTransaction,
    )
  }

  // Substitutes the session; access control and hooks still run against it
  // (orthogonal to `sudo`, so the receiver's sudo state is preserved).
  function withSession(newSession: Session | null): StackContext<AccessControlledDB> {
    return getContext(
      config,
      ormHandle,
      newSession,
      context.storage,
      _isSudo,
      undefined,
      // ADR-0028: a write issued from inside an owned transaction (e.g.
      // `tx.withSession(s).db.x.create()`) must still defer to that owner.
      context._transactionOwner,
      client,
      _unsafeTransaction,
    )
  }

  // Interactive, hook-firing transaction (#614). See the `transaction` doc on
  // `StackContext` above for the atomicity/isolation/retry contract.
  //
  // This call OWNS a deferral registry for its callback's writes (ADR-0028):
  // it always observes when its own callback settles — resolve/reject — even
  // when the underlying client cannot open a real interactive transaction, so
  // every `txContext.db.*` write defers its transaction-boundary bracket here
  // instead of firing eagerly, and this call flushes them with the real
  // outcome once the callback (and any real transaction) has settled. A
  // `transaction()` nested inside another joins the outer owner's queue
  // rather than creating a second one.
  function transaction<T>(
    fn: (txContext: StackTransactionContext<AccessControlledDB>) => Promise<T>,
  ): Promise<T> {
    if (context._transactionOwner) {
      return fn(transactionFace(returned, lock))
    }

    const registry = new TransactionRegistry()
    const ormClient = ormHandle as unknown as TransactionCapable

    const settled = runTransactionBody(fn, registry, ormClient)

    return settleTransactionOwner(settled, registry, config)
  }

  function runTransactionBody<T>(
    fn: (txContext: StackTransactionContext<AccessControlledDB>) => Promise<T>,
    registry: TransactionRegistry,
    ormClient: TransactionCapable,
  ): Promise<T> {
    const child = (
      ormHandle: OrmClient,
      unsafeTransaction?: UnsafeTransactionScope,
    ): StackTransactionContext<AccessControlledDB> =>
      transactionFace(
        getContext(
          config,
          ormHandle,
          session,
          context.storage,
          _isSudo,
          context.plugins,
          registry,
          client,
          unsafeTransaction,
        ),
        rowLockSeat(client, unsafeTransaction),
      )

    // Known limits: this branch hands `fn` a context whose `unsafe` is built
    // over the outer client, because a Prisma 7 transaction client carries no
    // `sql`/`orm` lanes to derive an `UnsafeTransactionScope` from. It is
    // unreachable while `$transaction` is a name no Prisma 8 object carries;
    // the moment the engine's handle becomes transaction-capable and takes
    // this branch, the scope has to be derived here too or `tx.unsafe` starts
    // executing outside the transaction it opened.
    if (typeof ormClient.$transaction === 'function') {
      return ormClient.$transaction((tx) => fn(child(tx))) as Promise<T>
    }

    // Prisma 8's transaction holds a pooled connection for the whole callback,
    // so the engine's handle is rebound to the transaction's own collections:
    // a `db` left on the outer handle would auto-commit outside the open
    // transaction, or wait forever for a second connection the dev database's
    // single-connection pool never frees (ADR-0056, ADR-0063).
    if (openTransaction !== undefined) {
      return openTransaction(async (opened) => fn(child(opened.ormHandle, opened.unsafe)))
    }

    // Already inside a transaction someone else opened: run directly, because
    // hook and access semantics are identical and the atomicity comes from
    // that enclosing transaction (ADR-0028).
    if (_unsafeTransaction !== undefined) {
      return fn(child(ormHandle, _unsafeTransaction))
    }

    return Promise.reject(new TransactionUnavailableError())
  }

  const returned: StackContext<AccessControlledDB> & EngineFaced = {
    db: db as AccessControlledDB,
    session,
    unsafe,
    storage: context.storage,
    plugins: context.plugins,
    serverAction,
    sudo,
    withSession,
    transaction,
    _isSudo,
    [ENGINE_FACE]: context,
  }
  return returned
}

/**
 * Complete the normalisation the engine terminal started, for a write.
 *
 * A terminal classifies by SQLSTATE alone — it holds no config, so a `23505`
 * leaves it as a `UniqueConstraintViolation` carrying the constraint
 * name and the generic message. Resolving that name to the OpenSaas fields it
 * covers needs the generated constraint map, which is reached through the
 * config, so the write operations close the gap here (ADR-0042).
 *
 * Reads are not wrapped: no read raises a unique violation, and every other
 * driver failure is already final at the terminal.
 */
function resolvingConstraints<Args extends unknown[], Result>(
  operation: (...args: Args) => Promise<Result>,
  config: OpenSaasConfig,
): (...args: Args) => Promise<Result> {
  return async (...args: Args): Promise<Result> => {
    try {
      return await operation(...args)
    } catch (error) {
      throw normalizeDatabaseError(error, config)
    }
  }
}

/**
 * Populate `target` with the access-controlled CRUD operations for every list,
 * each bound to `ormHandle` and `context`. Used both by {@link getContext} (at
 * request setup) and by the Write Pipeline to rebuild a `db` delegate against a
 * transaction client (ADR-0010), so a hook's `context.db` write participates in
 * the same transaction.
 *
 * The operations capture `ormHandle` at construction, so rebinding to a different
 * client (e.g. a transaction `tx`) requires rebuilding the delegate — which is
 * exactly what this function enables.
 */
export function populateDbDelegate(
  target: Record<string, unknown>,
  config: OpenSaasConfig,
  ormHandle: OrmClient,
  context: AccessContext,
  /** The row-lock lane, on a transaction-bound context alone (ADR-0047). */
  lock?: RowLockLane,
): void {
  for (const [listName, listConfig] of Object.entries(config.lists)) {
    const createOp = resolvingConstraints(
      createCreate(listName, listConfig, ormHandle, context, config),
      config,
    )
    const updateOp = resolvingConstraints(
      createUpdate(listName, listConfig, ormHandle, context, config),
      config,
    )
    const operations: Record<string, unknown> = {
      create: createOp,
      update: updateOp,
      delete: resolvingConstraints(
        createDelete(listName, listConfig, ormHandle, context, config),
        config,
      ),
    }

    const read = createSecuredRead({ listName, listConfig, ormHandle, context, config, lock })

    if (isSingletonList(listConfig)) {
      operations.get = resolvingConstraints(
        createGet(listName, listConfig, read, context, createOp),
        config,
      )
    } else {
      operations.where = read.where
      operations.orderBy = read.orderBy
      operations.include = read.include
      operations.select = read.select
      operations.limit = read.limit
      operations.offset = read.offset
      operations.distinct = read.distinct
      operations.distinctOn = read.distinctOn
      operations.cursor = read.cursor
      operations.forUpdate = read.forUpdate
      operations.all = read.all
      operations.first = read.first
      operations.nearest = read.nearest
      operations.aggregate = read.aggregate
    }

    target[listName] = operations
  }
}

/**
 * Build a fresh access-controlled `db` delegate bound to `ormHandle` and `context`.
 * Convenience wrapper over {@link populateDbDelegate} returning a new object,
 * used by the Write Pipeline to rebind `db` to a transaction client.
 *
 * The lock lane comes off `context._rowLock`, so a delegate rebuilt inside a
 * transaction keeps the `forUpdate()` its context already had (ADR-0047) — a
 * hook is a caller like any other. Its absence is the caller's statement that
 * this context is not the transaction's.
 */
export function buildDbDelegate(
  config: OpenSaasConfig,
  ormHandle: OrmClient,
  context: AccessContext,
): AccessControlledDB {
  const db: Record<string, unknown> = {}
  populateDbDelegate(db, config, ormHandle, context, context._rowLock)
  return db as AccessControlledDB
}

function createCreate(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  ormHandle: OrmClient,
  context: AccessContext,
  config: OpenSaasConfig,
) {
  // Thin adapter over the Write Pipeline: pick the create strategy, run the
  // canonical secured write sequence, return its result.
  return async (args: { data: Record<string, unknown> }) => {
    return runWritePipeline({
      listName,
      listConfig,
      ormHandle,
      context,
      config,
      inputData: args.data,
      strategy: createWriteStrategy(listName, listConfig, context),
    })
  }
}

function createUpdate(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  ormHandle: OrmClient,
  context: AccessContext,
  config: OpenSaasConfig,
) {
  // Thin adapter over the Write Pipeline: pick the update strategy, run the
  // canonical secured write sequence, return its result.
  return async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    // Runs before the pipeline's access gate — a `where` the engine cannot
    // lower is the caller's own shape error, not a denial.
    assertIdentityWhere(args.where, listName, 'update')

    return runWritePipeline({
      listName,
      listConfig,
      ormHandle,
      context,
      config,
      inputData: args.data,
      strategy: updateWriteStrategy(listName, listConfig, config, context, args.where),
    })
  }
}

function createDelete(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  ormHandle: OrmClient,
  context: AccessContext,
  config: OpenSaasConfig,
) {
  // Thin adapter over the Write Pipeline: pick the delete strategy, run the
  // canonical secured write sequence, return its result.
  return async (args: { where: Record<string, unknown> }) => {
    assertIdentityWhere(args.where, listName, 'delete')

    return runWritePipeline({
      listName,
      listConfig,
      ormHandle,
      context,
      config,
      inputData: undefined,
      strategy: deleteWriteStrategy(listName, listConfig, config, context, args.where),
    })
  }
}

/**
 * A singleton's read. The composed read is not offered on a singleton
 * (`populateDbDelegate` wires it in the other branch), but the engine drives it
 * here: `get()` resolves the one row through the same secured path an ordinary
 * list reads through, so operation access, the Access Filter, Field Visibility
 * and the related lists' own `query` access are the composed read's and not a
 * second copy of them.
 *
 * `null` from the read is denied-or-absent, so the auto-create below runs only
 * once the read has answered nothing — a denied session gets `null`, not a row.
 *
 * Known limits: auto-create fires only for a `query` rule that answered a
 * strict `true`, or under `sudo`. A rule that answered a filter scopes the read
 * rather than opening it, and there is no row yet to test that filter against,
 * so the create is refused and `get()` answers `null` — the same `null` a
 * denied or an absent row answers with.
 */
function createGet(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  read: SecuredQuery,
  context: AccessContext,
  createFn: (args: { data: Record<string, unknown> }) => Promise<OrmRow | null>,
) {
  return async (args?: {
    include?: Record<string, unknown>
    // `select` is not honoured — accepted only so the no-op can be made visible.
    select?: Record<string, unknown>
  }) => {
    warnIfSelectIgnored(args, listName, 'get')

    const scoped = Object.entries(args?.include ?? {}).reduce(
      (query, [name, requested]) => (requested ? query.include(name) : query),
      read,
    )

    const item = await scoped.first()
    if (item) return item

    if (!shouldAutoCreate(listConfig)) return null

    // `first()` conflates denied with absent, and auto-create must fire only on
    // absent — a denied session that provoked a create would both write a row it
    // may not read and turn the read's silence into an observable side effect.
    // Only a strict `true` clears the create: a filter scopes rather than opens,
    // and `false`, a missing rule and anything else are denials. This is the one
    // place the query rule is consulted directly; the read above owns every
    // other use of it.
    if (!context._isSudo) {
      const readable = await checkAccess(listConfig.access?.operation?.query, {
        session: context.session,
        context,
      })
      if (readable !== true) return null
    }

    await createFn({ data: getDefaultData(listConfig) })
    return await scoped.first()
  }
}
