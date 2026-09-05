import type { OpenSaasConfig, ListConfig } from '../config/types.js'
import { ormModel } from '../access/orm-client.js'
import type { Session, AccessContext, AccessControlledDB, StorageUtils } from '../access/index.js'
import {
  checkAccess,
  mergeFilters,
  filterReadableFields,
  buildAccessScopedInclude,
  buildAccessScopedWhere,
  stripVirtualFieldsFromInclude,
  widenIncludeForDependencies,
  validateQueryKeys,
  validateQueryFieldReadAccess,
  resolveToOneAccessVisibility,
  emptyToOneAccessFilterTree,
  emptyCountAccessDenialTree,
} from '../access/index.js'
import type {
  DependencyAdditions,
  ToOneAccessFilterTree,
  CountAccessDenialTree,
} from '../access/index.js'
import { ValidationError, DatabaseError } from '../hooks/index.js'
import { getDbKey } from '../lib/case-utils.js'
import { uniqueConstraintOf } from '../lib/prisma-errors.js'
import type { OrmClient } from '../access/types.js'
import type { StackContext } from '../types/context.js'
import { buildInclude, pickFields, isFragment, buildFieldSelectionScope } from '../query/index.js'
import type { FieldSelection, FieldSelectionScope } from '../query/index.js'
import { getRelationshipOptions } from '../query/relationship-options.js'
import {
  runWritePipeline,
  createWriteStrategy,
  updateWriteStrategy,
  deleteWriteStrategy,
} from './write-pipeline.js'
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
  // boundary. `mode: 'disconnect'` unlinks the row by disconnecting its
  // back-reference (`field`; `parentId` is needed only when that back-reference
  // is to-many, e.g. a many-to-many join) without deleting it; `mode: 'delete'`
  // truly deletes the row. Returns a distinct `{ removed }` shape, never
  // `success`, so a UI wrapper that redirects on `success` does not hijack an
  // in-place row removal.
  | {
      listKey: string
      action: 'removeRelated'
      mode: 'disconnect' | 'delete'
      id: string
      field?: string
      parentId?: string
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
    `[@opensaas/stack-core] \`select\` is ignored by context.db.${getDbKey(listName)}.${operation}() ` +
      `and the full (access-filtered) record is returned. ` +
      `Narrow a read with \`include\` or a fragment \`query\` instead. ` +
      `See https://stack.opensaas.au/docs/concepts/queries`,
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function isSingletonList(listConfig: ListConfig<any>): boolean {
  return !!listConfig.isSingleton
}

/**
 * Compute the set of single-field unique selectors a `findUnique` `where` may be
 * keyed by, derived from what the list config exposes at runtime: `id`, plus any
 * field declared `isIndexed: 'unique'` — for a `relationship` field, this is the
 * foreign-key column name (`<field>Id`), since that's the column Prisma marks
 * `@unique`, not the relation field itself.
 *
 * The config exposes no list-level compound (`@@unique`) declaration, so this
 * cannot validate a compound `<Model>_<a>_<b>` selector — `where` must contain
 * exactly one recognised single-field unique key and no others. This rejects
 * non-unique filters (#567) without ever rejecting a valid single-field unique
 * lookup; a compound-unique or otherwise non-unique lookup should use
 * `findFirst` instead (see #565).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function getUniqueWhereKeys(listConfig: ListConfig<any>): Set<string> {
  const keys = new Set<string>(['id'])

  for (const [fieldKey, fieldConfig] of Object.entries(listConfig.fields)) {
    if (!fieldConfig || typeof fieldConfig !== 'object') continue
    if (!('isIndexed' in fieldConfig) || fieldConfig.isIndexed !== 'unique') continue

    if (fieldConfig.type === 'relationship') {
      // A unique relationship's `@unique` lives on the FK column `<field>Id`.
      keys.add(`${fieldKey}Id`)
    } else {
      keys.add(fieldKey)
    }
  }

  return keys
}

/**
 * Enforce Keystone `findOne` semantics for `findUnique`: the caller-supplied
 * `where` must be a valid unique selector. A non-unique `where` is a caller-shape
 * error (not an access denial), so this THROWS rather than silently returning
 * `null` — consistent with the fail-loud-on-misuse stance of PRD #581. A
 * non-unique single-row lookup should use `findFirst` instead (see #565).
 */
function assertUniqueWhere(
  where: Record<string, unknown> | undefined,
  uniqueKeys: Set<string>,
  listName: string,
): void {
  const keys = where ? Object.keys(where) : []

  const message =
    `findUnique on "${listName}" requires a unique \`where\` (a single unique key such as ` +
    `${Array.from(uniqueKeys).join(', ')}). ` +
    `Received: ${keys.length === 0 ? '{}' : `{ ${keys.join(', ')} }`}. ` +
    `Use \`findFirst\` for a non-unique single-row lookup.`

  if (keys.length !== 1 || !uniqueKeys.has(keys[0])) {
    throw new ValidationError([message], {})
  }
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

// A camelCase field name (e.g. a relationship's `tenantId` foreign key) needs
// its word boundary split before title-casing, or it reads as one run-together
// word ("Tenantid") in a user-facing unique-constraint message.
function humanizeFieldName(fieldName: string): string {
  const spaced = fieldName.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function parsePrismaError(error: unknown, listConfig: ListConfig<any>): Error {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'meta' in error &&
    typeof error.code === 'string'
  ) {
    const prismaError = error as { code: string; meta?: { target?: string[] }; message?: string }

    // P2002 is Prisma's unique constraint violation code.
    if (prismaError.code === 'P2002') {
      const target = uniqueConstraintOf(prismaError)?.fields
      const fieldErrors: Record<string, string> = {}

      if (target && target.length > 0) {
        for (const fieldName of target) {
          const fieldConfig = listConfig.fields[fieldName]

          if (fieldConfig) {
            fieldErrors[fieldName] =
              `This ${humanizeFieldName(fieldName).toLowerCase()} is already in use`
          } else {
            fieldErrors[fieldName] = `This value is already in use`
          }
        }

        const fieldLabels = target.map(humanizeFieldName).join(', ')
        return new DatabaseError(
          `${fieldLabels} must be unique. The value you entered is already in use.`,
          fieldErrors,
          prismaError.code,
        )
      }

      return new DatabaseError('A record with this value already exists', {}, prismaError.code)
    }

    return new DatabaseError(
      prismaError.message || 'A database error occurred',
      {},
      prismaError.code,
    )
  }

  if (error instanceof Error) {
    return error
  }

  return new Error('An unknown error occurred')
}

/**
 * Mirrors Prisma's `TransactionIsolationLevel`. Provider support varies —
 * e.g. `Serializable` requires PostgreSQL.
 */
export type TransactionIsolationLevel =
  'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable' | 'Snapshot'

/**
 * Options for {@link StackContext.transaction}, forwarded verbatim to the
 * underlying Prisma interactive transaction.
 */
export interface TransactionOptions {
  /** Max ms to wait to acquire a transaction from the pool. */
  maxWait?: number
  /** Max ms the interactive transaction may run before timing out. */
  timeout?: number
  /** Isolation level for the transaction (e.g. `'Serializable'`). */
  isolationLevel?: TransactionIsolationLevel
}

/**
 * Minimal shape of a Prisma client that can open an interactive transaction.
 * A Prisma transaction client (the `tx` handed to the callback) intentionally
 * does NOT expose `$transaction`, which is how nested writes detect they are
 * already inside a transaction and join it rather than opening another.
 */
interface TransactionCapable {
  $transaction?: (
    fn: (tx: OrmClient) => Promise<unknown>,
    options?: TransactionOptions,
  ) => Promise<unknown>
}

/**
 * Drain a `context.transaction()` owner's deferral registry once its callback
 * (and any real underlying transaction) has settled (ADR-0028). A transaction/
 * callback error always wins — compensators still all run, but their errors
 * are discarded in favor of re-surfacing the original, matching the Write
 * Pipeline's `txError` precedence — otherwise any deferred `afterTransaction`
 * errors reject with {@link AfterTransactionError} even though the callback
 * succeeded and the transaction committed.
 */
async function settleTransactionOwner<T>(
  settled: Promise<T>,
  registry: TransactionRegistry,
): Promise<T> {
  const errors: unknown[] = []
  let result: T
  try {
    result = await settled
  } catch (err) {
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

export function getContext<TConfig extends OpenSaasConfig>(
  config: TConfig,
  prisma: OrmClient,
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
): StackContext<AccessControlledDB> {
  // Broad type to allow dynamic model access; populated by populateDbDelegate below.
  const db: Record<string, unknown> = {}

  const context: AccessContext = {
    session,
    prisma,
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
  }

  populateDbDelegate(db, config, prisma, context)

  // Skipped when reusing shared plugins (transaction rebind) so runtimes — and
  // any side effects they carry — run exactly once per top-level context.
  if (!_sharedPlugins) {
    const pluginsToExecute = config._plugins || config.plugins || []
    for (const plugin of pluginsToExecute) {
      if (plugin.runtime) {
        try {
          // Passed as a plain second argument rather than a method on
          // `context` itself — see the `sudo` param doc on `Plugin['runtime']`.
          context.plugins[plugin.name] = plugin.runtime(
            context,
            () => sudo() as unknown as AccessContext,
          )
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
  > {
    const dbKey = getDbKey(props.listKey)
    const listConfig = config.lists[props.listKey]

    if (!listConfig) {
      return {
        success: false,
        error: `List "${props.listKey}" not found in configuration`,
      }
    }

    const model = db[dbKey] as {
      create: (args: { data: Record<string, unknown> }) => Promise<unknown>
      update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>
      delete: (args: { where: { id: string } }) => Promise<unknown>
    }

    // Bulk delete: remove each id row-by-row through the secured context,
    // honouring Silent failure — a denied (or missing) row returns `null` and is
    // simply not counted. Returns "N of M" so partial denials are visible without
    // revealing which rows were denied or why. One row's error never aborts the
    // rest.
    if (props.action === 'bulkDelete') {
      let deleted = 0
      for (const id of props.ids) {
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
          return { bulkAction: false, error: error.message }
        }
        const dbError = parsePrismaError(error, listConfig)
        // A recognised Prisma error carries a user-safe, translated message.
        if (dbError instanceof DatabaseError) {
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
      try {
        let result: unknown = null
        if (props.mode === 'delete') {
          result = await model.delete({ where: { id: props.id } })
        } else {
          // Disconnect: an UPDATE on the related list nulling its back-reference,
          // never a delete — the row itself survives. A to-one back-reference
          // disconnects with `true`; a to-many back-reference (many-to-many)
          // disconnects the specific parent by id.
          if (!props.field) {
            return { removed: false, error: 'Missing back-reference field for disconnect' }
          }
          const backRefField = listConfig.fields[props.field]
          const backRefIsMany =
            !!backRefField && 'many' in backRefField && backRefField.many === true
          const disconnectValue = backRefIsMany
            ? { disconnect: { id: props.parentId } }
            : { disconnect: true }
          result = await model.update({
            where: { id: props.id },
            data: { [props.field]: disconnectValue },
          })
        }
        if (result === null || result === undefined) {
          return { removed: false, error: 'Access denied or operation failed' }
        }
        return { removed: true }
      } catch (error) {
        if (error instanceof ValidationError || error instanceof DatabaseError) {
          return { removed: false, error: error.message }
        }
        const dbError = parsePrismaError(error, listConfig)
        return { removed: false, error: dbError.message }
      }
    }

    // Runs on the RELATED list (ADR-0018 boundary — see ServerActionProps above).
    // The back-reference to the parent is set here from `field`/`parentId` (a
    // to-one back-ref connects a single parent; a to-many back-ref, e.g.
    // many-to-many, connects the parent by id), so the client can never
    // re-target the link. Honours Silent failure: an access-denied create
    // returns `null`, surfaced as `{ created: false }` with a generic reason
    // (no denied-vs-absent leak).
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
          const backRefField = listConfig.fields[props.field]
          // The back-reference must name a relationship field on this list; a
          // non-relationship field would otherwise receive a nonsensical
          // { connect } value. Also hardening — the drawer only ever passes a
          // real relationship back-reference here.
          if (!backRefField || backRefField.type !== 'relationship') {
            return {
              created: false,
              error: `Field "${props.field}" on list "${props.listKey}" is not a relationship field`,
            }
          }
          const backRefIsMany = 'many' in backRefField && backRefField.many === true
          // The back-reference is set on the SERVER from the trusted parentId,
          // OVERWRITING any client-supplied data[field] spread in above, so a
          // hostile client can never re-target the link (a to-many back-ref
          // connects the parent by id).
          data[props.field] = backRefIsMany
            ? { connect: [{ id: props.parentId }] }
            : { connect: { id: props.parentId } }
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
          return { created: false, error: error.message, fieldErrors: error.fieldErrors }
        }
        const dbError = parsePrismaError(error, listConfig)
        return {
          created: false,
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
      try {
        const result = await model.update({
          where: { id: props.id },
          data: { [props.field]: props.value },
        })
        if (result === null || result === undefined) {
          return { updated: false, error: 'Access denied or operation failed' }
        }
        return { updated: true }
      } catch (error) {
        if (error instanceof ValidationError || error instanceof DatabaseError) {
          return { updated: false, error: error.message, fieldErrors: error.fieldErrors }
        }
        const dbError = parsePrismaError(error, listConfig)
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
      } else if (props.action === 'update') {
        result = await model.update({
          where: { id: props.id },
          data: props.data,
        })
      } else if (props.action === 'delete') {
        result = await model.delete({
          where: { id: props.id },
        })
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
        return {
          success: false,
          error: error.message,
          fieldErrors: error.fieldErrors,
        }
      }

      const dbError = parsePrismaError(error, listConfig)
      if (dbError instanceof DatabaseError) {
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
      prisma,
      session,
      context.storage,
      true,
      undefined,
      // ADR-0028: a sudo write issued from inside an owned transaction (e.g.
      // `tx.sudo().db.x.create()`) must still defer to that owner.
      context._transactionOwner,
    )
  }

  // Substitutes the session; access control and hooks still run against it
  // (orthogonal to `sudo`, so the receiver's sudo state is preserved).
  function withSession(newSession: Session | null): StackContext<AccessControlledDB> {
    return getContext(
      config,
      prisma,
      newSession,
      context.storage,
      _isSudo,
      undefined,
      // ADR-0028: a write issued from inside an owned transaction (e.g.
      // `tx.withSession(s).db.x.create()`) must still defer to that owner.
      context._transactionOwner,
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
    fn: (txContext: StackContext<AccessControlledDB>) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    if (context._transactionOwner) {
      return fn(returned)
    }

    const registry = new TransactionRegistry()
    const client = prisma as unknown as TransactionCapable

    const settled =
      typeof client.$transaction !== 'function'
        ? // No interactive transaction available (plain client/mock, or already
          // inside one — see `TransactionCapable` above). Run directly: hook/
          // access semantics are identical, atomicity comes from the enclosing
          // transaction.
          fn(
            getContext(
              config,
              prisma,
              session,
              context.storage,
              _isSudo,
              context.plugins,
              registry,
            ),
          )
        : (client.$transaction(
            (tx) =>
              fn(
                getContext(
                  config,
                  tx,
                  session,
                  context.storage,
                  _isSudo,
                  context.plugins,
                  registry,
                ),
              ),
            options,
          ) as Promise<T>)

    return settleTransactionOwner(settled, registry)
  }

  const returned: StackContext<AccessControlledDB> = {
    db: db as AccessControlledDB,
    session,
    prisma,
    storage: context.storage,
    plugins: context.plugins,
    serverAction,
    sudo,
    withSession,
    transaction,
    _isSudo,
  }
  return returned
}

/**
 * Populate `target` with the access-controlled CRUD operations for every list,
 * each bound to `prisma` and `context`. Used both by {@link getContext} (at
 * request setup) and by the Write Pipeline to rebuild a `db` delegate against a
 * transaction client (ADR-0010), so a hook's `context.db` write participates in
 * the same transaction.
 *
 * The operations capture `prisma` at construction, so rebinding to a different
 * client (e.g. a transaction `tx`) requires rebuilding the delegate — which is
 * exactly what this function enables.
 */
export function populateDbDelegate(
  target: Record<string, unknown>,
  config: OpenSaasConfig,
  prisma: OrmClient,
  context: AccessContext,
): void {
  for (const [listName, listConfig] of Object.entries(config.lists)) {
    const dbKey = getDbKey(listName)

    const createOp = createCreate(listName, listConfig, prisma, context, config)
    const findManyOp = createFindMany(listName, listConfig, prisma, context, config)
    const updateOp = createUpdate(listName, listConfig, prisma, context, config)
    const operations: Record<string, unknown> = {
      findUnique: createFindUnique(listName, listConfig, prisma, context, config),
      findMany: findManyOp,
      findFirst: createFindFirst(findManyOp),
      create: createOp,
      update: updateOp,
      delete: createDelete(listName, listConfig, prisma, context, config),
      count: createCount(listName, listConfig, prisma, context, config),
      createMany: createCreateMany(listName, listConfig, prisma, context, config, createOp),
      updateMany: createUpdateMany(
        listName,
        listConfig,
        prisma,
        context,
        config,
        findManyOp,
        updateOp,
      ),
    }

    if (isSingletonList(listConfig)) {
      operations.get = createGet(listName, listConfig, prisma, context, config, createOp)
    }

    target[dbKey] = operations
  }
}

/**
 * Build a fresh access-controlled `db` delegate bound to `prisma` and `context`.
 * Convenience wrapper over {@link populateDbDelegate} returning a new object,
 * used by the Write Pipeline to rebind `db` to a transaction client.
 */
export function buildDbDelegate(
  config: OpenSaasConfig,
  prisma: OrmClient,
  context: AccessContext,
): AccessControlledDB {
  const db: Record<string, unknown> = {}
  populateDbDelegate(db, config, prisma, context)
  return db as AccessControlledDB
}

/**
 * Resolve the `include` (and declared-dependency provenance) a read should
 * use, preserving each existing path's exact shape — fragment / sudo /
 * caller include / bare (ADR-0024) — while folding declared dependencies
 * (`needs`, ADR-0025) into whichever of those the read is already using.
 *
 * A non-sudo fragment's own `include` and a non-sudo caller's `include` are
 * both folded and then scoped by `buildAccessScopedInclude` (ADR-0026) —
 * caller-directed, so a relation named nowhere in the folded tree never has
 * its list's `query` access evaluated at all (issue #1088: a fragment read
 * used to skip this walk entirely). A sudo caller's `include` (fragment or
 * not) is folded and used as-is, unscoped — sudo is unaffected. A bare read
 * stays on the exact ADR-0024 path — `include: undefined`, no related
 * `query` access evaluated — unless folding actually added something, which
 * only happens when a field on this list declares `needs`.
 *
 * Also returns the `FieldSelectionScope` a fragment's own field selection
 * produces (ADR-0027), so the caller can pass it to `filterReadableFields`
 * and make computation itself projection-aware, not only the fold above.
 * `undefined` for every non-fragment path: a caller `include` (sudo or not)
 * and a bare read both mean "compute every field," matching what they
 * already fetch.
 *
 * Also returns `toOneAccessFilters` — the to-one relations `buildAccessScopedInclude`
 * flagged as needing a post-query existence check rather than a Prisma-side
 * `where` (issue #974). Only a non-sudo fragment or caller-include read can
 * produce a non-empty tree: those are the only paths that evaluate a related
 * list's `query` access at all. A sudo read and a bare read always return an
 * empty tree.
 */
async function resolveReadInclude(
  callerInclude: Record<string, unknown> | undefined,
  fragmentFields: FieldSelection<unknown> | undefined,
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  context: AccessContext & { _isSudo?: boolean },
  config: OpenSaasConfig,
): Promise<{
  include: Record<string, unknown> | undefined
  additions: DependencyAdditions
  selection: FieldSelectionScope | undefined
  toOneAccessFilters: ToOneAccessFilterTree
  countDenials: CountAccessDenialTree
}> {
  if (fragmentFields !== undefined) {
    const fragmentInclude = buildInclude(fragmentFields) ?? undefined
    const selection = buildFieldSelectionScope(fragmentFields)
    const widened = widenIncludeForDependencies(
      fragmentInclude,
      listConfig.fields,
      config,
      listName,
      selection,
    )

    if (context._isSudo || !widened.include) {
      return {
        ...widened,
        selection,
        toOneAccessFilters: emptyToOneAccessFilterTree(),
        countDenials: emptyCountAccessDenialTree(),
      }
    }

    const { include, toOneAccessFilters, countDenials } = await buildAccessScopedInclude(
      widened.include,
      listConfig.fields,
      { session: context.session, context },
      config,
      listName,
    )
    return {
      include,
      additions: widened.additions,
      selection,
      toOneAccessFilters,
      countDenials,
    }
  }

  if (context._isSudo) {
    const widened = widenIncludeForDependencies(callerInclude, listConfig.fields, config, listName)
    return {
      ...widened,
      selection: undefined,
      toOneAccessFilters: emptyToOneAccessFilterTree(),
      countDenials: emptyCountAccessDenialTree(),
    }
  }

  const widened = widenIncludeForDependencies(callerInclude, listConfig.fields, config, listName)
  if (!widened.include) {
    return {
      ...widened,
      selection: undefined,
      toOneAccessFilters: emptyToOneAccessFilterTree(),
      countDenials: emptyCountAccessDenialTree(),
    }
  }

  const { include, toOneAccessFilters, countDenials } = await buildAccessScopedInclude(
    widened.include,
    listConfig.fields,
    { session: context.session, context },
    config,
    listName,
  )
  return {
    include,
    additions: widened.additions,
    selection: undefined,
    toOneAccessFilters,
    countDenials,
  }
}

function createFindUnique(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: OrmClient,
  context: AccessContext,
  config: OpenSaasConfig,
) {
  return async (args: {
    // No static type restricts this to the list's unique keys: the generated
    // `ListUniqueWhere` admits any stored column, optionally. The runtime
    // guard below is the only thing that rejects a non-unique `where`.
    where: Record<string, unknown>
    include?: Record<string, unknown>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query?: any
    // `select` is not honoured — accepted only so the no-op can be made visible.
    select?: Record<string, unknown>
  }) => {
    warnIfSelectIgnored(args, listName, 'findUnique')

    // Runs first, before the access check below — a non-unique `where` is a
    // caller-shape error (see `assertUniqueWhere`), not an access denial.
    // Typed callers reach here too: `ListUniqueWhere` is derived from the
    // list's stored columns, not from the contract's unique constraints, so
    // `findUnique({ where: { title: 'x' } })` type-checks and fails here.
    assertUniqueWhere(args.where, getUniqueWhereKeys(listConfig), listName)

    let where: Record<string, unknown> = args.where
    if (!context._isSudo) {
      const queryAccess = listConfig.access?.operation?.query
      const accessResult = await checkAccess(queryAccess, {
        session: context.session,
        context,
      })

      if (accessResult === false) {
        return null
      }

      const mergedWhere = mergeFilters(args.where, accessResult)
      if (mergedWhere === null) {
        return null
      }
      where = mergedWhere
    }

    // Access control still runs via filterReadableFields even though a
    // fragment drives `include`; the fragment only narrows which fields come back.
    const fragment = isFragment(args.query) ? args.query : null

    // Resolve `include`, folding any declared dependencies (`needs`,
    // ADR-0025) in alongside whatever the fragment/caller/sudo/bare path
    // already produces — see `resolveReadInclude`'s doc comment.
    let { include, additions, selection, toOneAccessFilters, countDenials } =
      await resolveReadInclude(
        args.include,
        fragment ? fragment._fields : undefined,
        listName,
        listConfig,
        context,
        config,
      )

    // Virtual fields have no database column. Whichever path produced
    // `include` (fragment, access-controlled merge, or sudo passthrough), a
    // virtual key must never reach Prisma — it would throw "Unknown field"
    // (#628). Below, `filterReadableFields` computes a virtual field's value
    // exactly when `selection` says the read is going to return it (ADR-0027)
    // — every one of them for a bare/`include`-based read (`selection` is
    // `undefined`), only the ones a fragment named otherwise.
    include = stripVirtualFieldsFromInclude(include, listConfig.fields, config)

    // Access Prisma model dynamically - required because model names are generated at runtime
    const model = ormModel(prisma, listName)
    const item = await model.findFirst({
      where,
      include,
    })

    if (!item) {
      return null
    }

    // Resolve which of the to-one relations flagged by `toOneAccessFilters`
    // actually survive their related list's `query` access (issue #974) —
    // one batched existence check per relation, before field visibility runs.
    const toOneVisibility = await resolveToOneAccessVisibility([item], toOneAccessFilters, {
      session: context.session,
      context,
    })

    // Pass sudo flag through context to skip field-level access checks
    const filtered = await filterReadableFields(
      item,
      listConfig.fields,
      {
        session: context.session,
        context: { ...context, _isSudo: context._isSudo },
      },
      config,
      0,
      listName,
      additions,
      selection,
      toOneVisibility,
      countDenials,
    )

    if (fragment) {
      return pickFields(filtered, fragment._fields)
    }

    return filtered
  }
}

function createFindMany(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: OrmClient,
  context: AccessContext,
  config: OpenSaasConfig,
) {
  return async (args?: {
    where?: Record<string, unknown>
    orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
    take?: number
    skip?: number
    include?: Record<string, unknown>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query?: any
    // `select` is not honoured — accepted only so the no-op can be made visible.
    select?: Record<string, unknown>
  }) => {
    warnIfSelectIgnored(args, listName, 'findMany')

    // Singleton misuse throws rather than silently returning `[]` — unlike an
    // access denial, this is a caller-shape error.
    if (isSingletonList(listConfig)) {
      throw new ValidationError(
        [`Cannot use findMany: ${listName} is a singleton list. Use get() instead.`],
        {},
      )
    }

    // Check query access first (skip if sudo mode) — this MUST run before the
    // #912/#915 where/orderBy validation below. See the comment there for why.
    let where: Record<string, unknown> | undefined = args?.where
    if (!context._isSudo) {
      const queryAccess = listConfig.access?.operation?.query
      const accessResult = await checkAccess(queryAccess, {
        session: context.session,
        context,
      })

      if (accessResult === false) {
        return []
      }

      // #912 — reject a `where`/`orderBy` key the list config doesn't declare
      // (e.g. a Prisma-generated back-relation), and #915 — reject one naming
      // a field this session cannot READ (closing a probe via a `count()`
      // that varies with the withheld value, or an `orderBy` that leaks
      // relative ordering). Both run only now that the caller is known to
      // have SOME access to the list (`accessResult !== false`): the thrown
      // errors name the offending key, and running them before the access
      // check above would let a caller with ZERO access to the list learn a
      // field's name and read-gating status from the error message alone —
      // turning the validation itself into the kind of oracle #915 closes.
      // `sudo` bypasses this whole branch, matching the write path.
      validateQueryKeys({
        where: args?.where,
        orderBy: args?.orderBy,
        listConfig,
        listName,
        config,
        isSudo: false,
      })
      await validateQueryFieldReadAccess({
        where: args?.where,
        orderBy: args?.orderBy,
        listConfig,
        listName,
        session: context.session,
        context,
        isSudo: false,
      })

      // #916 — scope every relation filter nested in `where`
      // (`some`/`every`/`none`/`is`/`isNot`) by the RELATED list's own `query`
      // access, recursing through every hop of a chain — the `where`
      // counterpart to how `include` is already scoped below via
      // `buildAccessScopedInclude`. Runs after the checks above for the same
      // ordering reason: only once the caller is known to have SOME access to
      // THIS list.
      const scopedWhere = args?.where
        ? ((await buildAccessScopedWhere(args.where, listConfig, listName, config, {
            session: context.session,
            context,
          })) as Record<string, unknown>)
        : args?.where

      const mergedWhere = mergeFilters(scopedWhere, accessResult)
      if (mergedWhere === null) {
        return []
      }
      where = mergedWhere
    }

    const fragment = isFragment(args?.query) ? args.query : null

    // Resolve `include`, folding any declared dependencies (`needs`,
    // ADR-0025) in alongside whatever the fragment/caller/sudo/bare path
    // already produces — see `resolveReadInclude`'s doc comment.
    let { include, additions, selection, toOneAccessFilters, countDenials } =
      await resolveReadInclude(
        args?.include,
        fragment ? fragment._fields : undefined,
        listName,
        listConfig,
        context,
        config,
      )

    // Strips virtual keys from `include` before the Prisma call — see the
    // `createFindUnique` comment above for why (#628, ADR-0027).
    include = stripVirtualFieldsFromInclude(include, listConfig.fields, config)

    // Access Prisma model dynamically - required because model names are generated at runtime
    const model = ormModel(prisma, listName)
    const items = await model.findMany({
      where,
      orderBy: args?.orderBy,
      take: args?.take,
      skip: args?.skip,
      include,
    })

    // Resolve which of the to-one relations flagged by `toOneAccessFilters`
    // actually survive their related list's `query` access (issue #974) —
    // ONE batched existence check per relation across every row in `items`,
    // before field visibility runs on any of them.
    const toOneVisibility = await resolveToOneAccessVisibility(items, toOneAccessFilters, {
      session: context.session,
      context,
    })

    // Pass sudo flag through context to skip field-level access checks
    const filtered = await Promise.all(
      items.map((item: Record<string, unknown>) =>
        filterReadableFields(
          item,
          listConfig.fields,
          {
            session: context.session,
            context: { ...context, _isSudo: context._isSudo },
          },
          config,
          0,
          listName,
          additions,
          selection,
          toOneVisibility,
          countDenials,
        ),
      ),
    )

    if (fragment) {
      return filtered.map((item: Record<string, unknown>) => pickFields(item, fragment._fields))
    }

    return filtered
  }
}

/**
 * Create findFirst operation with access control.
 *
 * findFirst is sugar over the access-controlled findMany: it runs the exact same
 * query-access checks and access-controlled include building as findMany, then
 * returns the first matching row (or null when nothing matches). This introduces
 * no new access surface — it inherits findMany's silent-failure contract (an
 * access-denied query yields `[]`, which becomes `null` here).
 */
function createFindFirst(findManyOp: ReturnType<typeof createFindMany>) {
  return async (args?: {
    where?: Record<string, unknown>
    orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
    skip?: number
    include?: Record<string, unknown>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query?: any
    // `select` is not honoured — accepted only so the no-op can be made visible.
    select?: Record<string, unknown>
  }) => {
    const result = await findManyOp({ ...args, take: 1 })
    return result[0] ?? null
  }
}

function createCreate(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: OrmClient,
  context: AccessContext,
  config: OpenSaasConfig,
) {
  // Thin adapter over the Write Pipeline: pick the create strategy, run the
  // canonical secured write sequence, return its result.
  return async (args: { data: Record<string, unknown> }) => {
    return runWritePipeline({
      listName,
      listConfig,
      prisma,
      context,
      config,
      inputData: args.data,
      strategy: createWriteStrategy(listName, listConfig, context),
    })
  }
}

// Runs create in a loop (not Prisma's native createMany) so every item still
// gets its own hooks and access control.
function createCreateMany(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: OrmClient,
  context: AccessContext,
  config: OpenSaasConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createFn: any,
) {
  return async (args: { data: Record<string, unknown>[] }) => {
    const results = []

    for (const item of args.data) {
      const result = await createFn({ data: item })
      results.push(result)
    }

    return results
  }
}

function createUpdate(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: OrmClient,
  context: AccessContext,
  config: OpenSaasConfig,
) {
  // Thin adapter over the Write Pipeline: pick the update strategy, run the
  // canonical secured write sequence, return its result.
  return async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    return runWritePipeline({
      listName,
      listConfig,
      prisma,
      context,
      config,
      inputData: args.data,
      strategy: updateWriteStrategy(listConfig, context, args.where),
    })
  }
}

// Finds matching records, then updates each individually (not Prisma's native
// updateMany) so every item still gets its own hooks and access control.
function createUpdateMany(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: OrmClient,
  context: AccessContext,
  config: OpenSaasConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findManyFn: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateFn: any,
) {
  return async (args: { where?: Record<string, unknown>; data: Record<string, unknown> }) => {
    const items = await findManyFn({ where: args.where })

    const results = []
    for (const item of items) {
      const result = await updateFn({ where: { id: item.id }, data: args.data })
      results.push(result)
    }

    return results
  }
}

function createDelete(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: OrmClient,
  context: AccessContext,
  config: OpenSaasConfig,
) {
  // Thin adapter over the Write Pipeline: pick the delete strategy, run the
  // canonical secured write sequence, return its result.
  return async (args: { where: { id: string } }) => {
    return runWritePipeline({
      listName,
      listConfig,
      prisma,
      context,
      config,
      inputData: undefined,
      strategy: deleteWriteStrategy(listName, listConfig, context, args.where),
    })
  }
}

function createCount(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: OrmClient,
  context: AccessContext,
  config: OpenSaasConfig,
) {
  return async (args?: { where?: Record<string, unknown> }) => {
    // Check query access first (skip if sudo mode) — this MUST run before the
    // #912/#915 where validation below. See the comment there for why.
    let where: Record<string, unknown> | undefined = args?.where
    if (!context._isSudo) {
      const queryAccess = listConfig.access?.operation?.query
      const accessResult = await checkAccess(queryAccess, {
        session: context.session,
        context,
      })

      if (accessResult === false) {
        return 0
      }

      // #912 — reject a `where` key the list config doesn't declare (e.g. a
      // Prisma-generated back-relation), and #915 — reject one naming a field
      // this session cannot READ. `count` leaks the most cleanly of any read
      // op — a bare count answers a predicate with no rows returned at all —
      // so it gets the same reject, not a lesser one. Both run only now that
      // the caller is known to have SOME access to the list (`accessResult
      // !== false`) — see the identical comment in `createFindMany` for why
      // that ordering matters: running them before the access check would
      // let a fully-denied caller learn a field's name and read-gating
      // status from the thrown error alone. `sudo` bypasses this whole
      // branch, matching the write path.
      validateQueryKeys({
        where: args?.where,
        listConfig,
        listName,
        config,
        isSudo: false,
      })
      await validateQueryFieldReadAccess({
        where: args?.where,
        listConfig,
        listName,
        session: context.session,
        context,
        isSudo: false,
      })

      // #916 — scope every relation filter nested in `where` by the RELATED
      // list's own `query` access. See the identical comment in
      // `createFindMany` for why this runs here, in this order.
      const scopedWhere = args?.where
        ? ((await buildAccessScopedWhere(args.where, listConfig, listName, config, {
            session: context.session,
            context,
          })) as Record<string, unknown>)
        : args?.where

      const mergedWhere = mergeFilters(scopedWhere, accessResult)
      if (mergedWhere === null) {
        return 0
      }
      where = mergedWhere
    }

    // Access Prisma model dynamically - required because model names are generated at runtime
    const model = ormModel(prisma, listName)
    const count = await model.count({
      where,
    })

    return count
  }
}

function createGet(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: OrmClient,
  context: AccessContext,
  config: OpenSaasConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createFn: any,
) {
  return async (args?: {
    include?: Record<string, unknown>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query?: any
    // `select` is not honoured — accepted only so the no-op can be made visible.
    select?: Record<string, unknown>
  }) => {
    warnIfSelectIgnored(args, listName, 'get')

    let where: Record<string, unknown> = {}
    if (!context._isSudo) {
      const queryAccess = listConfig.access?.operation?.query
      const accessResult = await checkAccess(queryAccess, {
        session: context.session,
        context,
      })

      if (accessResult === false) {
        return null
      }

      // A singleton has no per-record `where`, so the access filter (if any) is
      // the whole `where`.
      if (accessResult && typeof accessResult === 'object') {
        where = accessResult
      }
    }

    // Access control still runs via filterReadableFields even though a
    // fragment drives `include`; the fragment only narrows which fields come back.
    const fragment = isFragment(args?.query) ? args.query : null

    // Resolve `include`, folding any declared dependencies (`needs`,
    // ADR-0025) in alongside whatever the fragment/caller/sudo/bare path
    // already produces — see `resolveReadInclude`'s doc comment.
    let { include, additions, selection, toOneAccessFilters, countDenials } =
      await resolveReadInclude(
        args?.include,
        fragment ? fragment._fields : undefined,
        listName,
        listConfig,
        context,
        config,
      )

    // Virtual fields have no database column and must never reach Prisma (#628).
    include = stripVirtualFieldsFromInclude(include, listConfig.fields, config)

    // Access Prisma model dynamically - required because model names are generated at runtime
    const model = ormModel(prisma, listName)
    const item = await model.findFirst({
      where,
      include,
    })

    if (item) {
      // Resolve which of the to-one relations flagged by `toOneAccessFilters`
      // actually survive their related list's `query` access (issue #974).
      const toOneVisibility = await resolveToOneAccessVisibility([item], toOneAccessFilters, {
        session: context.session,
        context,
      })

      const filtered = await filterReadableFields(
        item,
        listConfig.fields,
        {
          session: context.session,
          context: { ...context, _isSudo: context._isSudo },
        },
        config,
        0,
        listName,
        additions,
        selection,
        toOneVisibility,
        countDenials,
      )
      if (fragment) {
        return pickFields(filtered, fragment._fields)
      }
      return filtered
    }

    if (shouldAutoCreate(listConfig)) {
      const defaultData = getDefaultData(listConfig)
      return await createFn({ data: defaultData })
    }

    return null
  }
}
