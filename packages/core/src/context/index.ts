import type { OpenSaasConfig, ListConfig } from '../config/types.js'
import type { Session, AccessContext, AccessControlledDB, StorageUtils } from '../access/index.js'
import {
  checkAccess,
  mergeFilters,
  filterReadableFields,
  buildIncludeWithAccessControl,
  mergeIncludeWithAccessControl,
  stripVirtualFieldsFromInclude,
} from '../access/index.js'
import { ValidationError, DatabaseError } from '../hooks/index.js'
import { getDbKey } from '../lib/case-utils.js'
import type { PrismaClientLike } from '../access/types.js'
import { buildInclude, pickFields, isFragment } from '../query/index.js'
import { getRelationshipOptions } from '../query/relationship-options.js'
import {
  runWritePipeline,
  createWriteStrategy,
  updateWriteStrategy,
  deleteWriteStrategy,
} from './write-pipeline.js'

export type ServerActionProps =
  | { listKey: string; action: 'create'; data: Record<string, unknown> }
  | { listKey: string; action: 'update'; id: string; data: Record<string, unknown> }
  | { listKey: string; action: 'delete'; id: string }
  | {
      listKey: string
      action: 'relationshipOptions'
      field: string
      search?: string
      take?: number
      selectedIds?: string[]
    }

/**
 * Tracks which (listName, operation) pairs have already warned about an ignored
 * `select` argument, so a misused read op warns once rather than on every call.
 */
const selectWarnings = new Set<string>()

/**
 * Warn (once per list+operation) when a caller passes a `select` argument to a
 * read op that does not honour it.
 *
 * `context.db` reads never apply Prisma `select` semantics — narrowing is done
 * via `include` or a fragment `query`. The op still runs and returns the full,
 * access-filtered result, so this is a visible no-op rather than an error.
 *
 * Centralised here so every affected read op shares one implementation.
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
      `See https://stack.opensaas.au/docs/core-concepts/queries`,
  )
}

/**
 * Check if a list is configured as a singleton
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function isSingletonList(listConfig: ListConfig<any>): boolean {
  return !!listConfig.isSingleton
}

/**
 * Compute the set of single-field unique selectors a `findUnique` `where` may be
 * keyed by, derived from what the list config exposes at runtime.
 *
 * The set is:
 * - `id` — always a unique identifier on every list.
 * - Any field declared `isIndexed: 'unique'` in the config (e.g. `text({ isIndexed: 'unique' })`).
 * - For a `relationship` field declared `isIndexed: 'unique'`, the foreign-key
 *   column name (`<field>Id`) — that is the column Prisma marks `@unique`, so the
 *   unique `where` is keyed by `<field>Id`, not the relation field itself.
 *
 * Chosen rule (documented intentionally): the config does NOT expose compound
 * (`@@unique`) keys at runtime — there is no list-level unique declaration in the
 * config API — so we cannot validate compound `<Model>_<a>_<b>` selectors. We
 * therefore enforce the tractable subset: `where` must contain EXACTLY ONE
 * recognised single-field unique key and NO other keys. This rejects non-unique
 * filters (the bug in #567) and rejects extra non-unique keys alongside a unique
 * one, while never falsely rejecting a valid single-field unique lookup. If a
 * project legitimately needs a compound-unique lookup, that path is not covered
 * here and would need explicit config support; the safe escape hatch for any
 * non-unique single-row lookup is `findFirst` (see #565).
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

/**
 * Check if auto-create is enabled for a singleton list
 * Defaults to true if not explicitly set to false
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function shouldAutoCreate(listConfig: ListConfig<any>): boolean {
  if (!listConfig.isSingleton) return false
  if (typeof listConfig.isSingleton === 'boolean') return true
  return listConfig.isSingleton.autoCreate !== false
}

/**
 * Extract default values from field configs
 * Used to auto-create singleton records with sensible defaults
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function getDefaultData(listConfig: ListConfig<any>): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  for (const [fieldKey, fieldConfig] of Object.entries(listConfig.fields)) {
    // Skip virtual fields - they're not stored in database
    if (fieldConfig.virtual) continue

    // Skip system fields (id, createdAt, updatedAt)
    if (fieldKey === 'id' || fieldKey === 'createdAt' || fieldKey === 'updatedAt') continue

    // Add default value if present
    if ('defaultValue' in fieldConfig && fieldConfig.defaultValue !== undefined) {
      data[fieldKey] = fieldConfig.defaultValue
    }
  }

  return data
}

/**
 * Parse Prisma error and convert to user-friendly DatabaseError
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function parsePrismaError(error: unknown, listConfig: ListConfig<any>): Error {
  // Check if it's a Prisma error
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'meta' in error &&
    typeof error.code === 'string'
  ) {
    const prismaError = error as { code: string; meta?: { target?: string[] }; message?: string }

    // Handle unique constraint violation
    if (prismaError.code === 'P2002') {
      const target = prismaError.meta?.target
      const fieldErrors: Record<string, string> = {}

      if (target && Array.isArray(target)) {
        // Get field names from the constraint target
        for (const fieldName of target) {
          // Get the field config to get a better label
          const fieldConfig = listConfig.fields[fieldName]
          const label = fieldName.charAt(0).toUpperCase() + fieldName.slice(1)

          if (fieldConfig) {
            fieldErrors[fieldName] = `This ${label.toLowerCase()} is already in use`
          } else {
            fieldErrors[fieldName] = `This value is already in use`
          }
        }

        // Create a user-friendly general message
        const fieldLabels = target.map((f) => f.charAt(0).toUpperCase() + f.slice(1)).join(', ')
        return new DatabaseError(
          `${fieldLabels} must be unique. The value you entered is already in use.`,
          fieldErrors,
          prismaError.code,
        )
      }

      return new DatabaseError('A record with this value already exists', {}, prismaError.code)
    }

    // Handle other Prisma errors - return generic message
    return new DatabaseError(
      prismaError.message || 'A database error occurred',
      {},
      prismaError.code,
    )
  }

  // Not a Prisma error, return as-is if it's already an Error
  if (error instanceof Error) {
    return error
  }

  // Unknown error type
  return new Error('An unknown error occurred')
}

/**
 * Database transaction isolation levels.
 *
 * Mirrors Prisma's `TransactionIsolationLevel`. The level passed to
 * {@link StackContext.transaction} is forwarded to the underlying interactive
 * transaction; provider support varies (e.g. `Serializable` is supported by
 * PostgreSQL — required for the concurrency-sensitive capacity-gate pattern).
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
interface TransactionCapable<TPrisma> {
  $transaction?: (
    fn: (tx: TPrisma) => Promise<unknown>,
    options?: TransactionOptions,
  ) => Promise<unknown>
}

/**
 * The access-controlled context returned by {@link getContext}.
 *
 * Exposes the secured `db` delegate plus the session, raw `prisma`, storage,
 * plugin services, the generic `serverAction` handler, `sudo()` (bypasses access
 * control but still runs hooks), and `transaction()` (interactive, hook-firing
 * transaction). All access-checked operations run their list/field hooks.
 */
export interface StackContext<TPrisma extends PrismaClientLike = PrismaClientLike> {
  db: AccessControlledDB<TPrisma>
  session: Session | null
  prisma: TPrisma
  storage: StorageUtils
  plugins: Record<string, unknown>
  serverAction: (props: ServerActionProps) => Promise<unknown>
  /**
   * Run `fn` inside ONE interactive transaction. The `txContext` handed to `fn`
   * is a full {@link StackContext} whose `db.*` operations are access-checked and
   * hook-firing (identical to this context) but persist against the transaction
   * client, so every write in the callback is atomic — a throw anywhere rolls the
   * whole transaction back.
   *
   * `options` (notably `isolationLevel`) is forwarded to the underlying Prisma
   * transaction. Serialization failures (e.g. Prisma `P2034`) propagate to the
   * caller rather than being swallowed, so the caller can own a retry loop. If
   * the client cannot open an interactive transaction (e.g. a plain mock, or we
   * are already inside a transaction), `fn` runs directly against the current
   * client with identical hook/access semantics.
   *
   * Caveat: plugin runtime services (`txContext.plugins`) stay bound to the
   * top-level (non-transaction) client — they are shared services initialised
   * once per request. Reads through a plugin service therefore won't see this
   * transaction's uncommitted writes, and a plugin service that WRITES would
   * escape the transaction and survive a rollback. Use `txContext.db` (not a
   * plugin service) for writes that must be atomic with the transaction.
   */
  transaction: <T>(
    fn: (txContext: StackContext<TPrisma>) => Promise<T>,
    options?: TransactionOptions,
  ) => Promise<T>
  sudo: () => StackContext<TPrisma>
  _isSudo: boolean
}

/**
 * Create an access-controlled context
 *
 * @param config - OpenSaas configuration
 * @param prisma - Your Prisma client instance (pass as generic for type safety)
 * @param session - Current session object (or null if not authenticated)
 * @param storage - Optional storage utilities (uploadFile, uploadImage, deleteFile, deleteImage)
 */
export function getContext<
  TConfig extends OpenSaasConfig,
  TPrisma extends PrismaClientLike = PrismaClientLike,
>(
  config: TConfig,
  prisma: TPrisma,
  session: Session | null,
  storage?: StorageUtils,
  _isSudo: boolean = false,
  // Internal: when rebuilding the context against a transaction client, reuse the
  // already-initialised plugin services rather than re-running plugin runtimes.
  _sharedPlugins?: Record<string, unknown>,
): StackContext<TPrisma> {
  // Initialize db object - will be populated with access-controlled operations
  // Type is intentionally broad to allow dynamic model access
  const db: Record<string, unknown> = {}

  // Create context with db reference (will be populated below)
  // Storage utilities can be provided via parameter or use default stubs
  const context: AccessContext<TPrisma> = {
    session,
    prisma: prisma as TPrisma,
    db: db as AccessControlledDB<TPrisma>,
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
    _resolveOutputCounter: { depth: 0 },
  }

  // Create access-controlled operations for each list, populating `db` in place.
  populateDbDelegate(db, config, prisma, context)

  // Execute plugin runtime functions and populate context.plugins.
  // Skipped when reusing shared plugins (transaction rebind) so runtimes — and
  // any side effects they carry — run exactly once per top-level context.
  // Use _plugins (sorted by dependencies) if available, otherwise fall back to plugins array
  if (!_sharedPlugins) {
    const pluginsToExecute = config._plugins || config.plugins || []
    for (const plugin of pluginsToExecute) {
      if (plugin.runtime) {
        try {
          // Passed as a plain second argument rather than a method on
          // `context` itself — see the `sudo` param doc on `Plugin['runtime']`.
          context.plugins[plugin.name] = plugin.runtime(
            context,
            () => sudo() as unknown as AccessContext<TPrisma>,
          )
        } catch (error) {
          console.error(`Error executing runtime for plugin "${plugin.name}":`, error)
          // Continue with other plugins even if one fails
        }
      }
    }
  }

  // Generic server action handler with discriminated union for type safety
  // Returns a result object instead of throwing to work properly in Next.js production
  async function serverAction(
    props: ServerActionProps,
  ): Promise<
    | { success: true; data: unknown }
    | { success: false; error: string; fieldErrors?: Record<string, string> }
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
      // Handle ValidationError (has fieldErrors)
      if (error instanceof ValidationError) {
        return {
          success: false,
          error: error.message,
          fieldErrors: error.fieldErrors,
        }
      }

      // Handle DatabaseError (has fieldErrors)
      if (error instanceof DatabaseError) {
        return {
          success: false,
          error: error.message,
          fieldErrors: error.fieldErrors,
        }
      }

      // Parse and convert Prisma errors to user-friendly DatabaseError
      const dbError = parsePrismaError(error, listConfig)
      if (dbError instanceof DatabaseError) {
        return {
          success: false,
          error: dbError.message,
          fieldErrors: dbError.fieldErrors,
        }
      }

      // Generic error fallback
      return {
        success: false,
        error: dbError.message,
      }
    }
  }

  // Sudo function - creates a new context that bypasses access control
  // but still executes all hooks and validation
  function sudo(): StackContext<TPrisma> {
    return getContext(config, prisma, session, context.storage, true)
  }

  // Interactive, hook-firing transaction (#614). Rebinds the access-controlled
  // context to the transaction client so every `txContext.db.*` write runs its
  // access checks + hooks but persists inside ONE transaction (atomic). The
  // transaction `options` (e.g. `isolationLevel`) pass through to Prisma, and a
  // serialization failure thrown inside the callback propagates to the caller
  // for retry (it is never converted to a silent `null`).
  function transaction<T>(
    fn: (txContext: StackContext<TPrisma>) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const client = prisma as unknown as TransactionCapable<TPrisma>
    if (typeof client.$transaction !== 'function') {
      // No interactive transaction available — either a plain client/mock or we
      // are already inside a transaction (a Prisma tx client exposes no
      // `$transaction`). Run directly: hook/access semantics are identical and
      // atomicity is provided by any enclosing transaction.
      return fn(returned)
    }
    return client.$transaction(
      (tx) => fn(getContext(config, tx, session, context.storage, _isSudo, context.plugins)),
      options,
    ) as Promise<T>
  }

  const returned: StackContext<TPrisma> = {
    db: db as AccessControlledDB<TPrisma>,
    session,
    prisma,
    storage: context.storage,
    plugins: context.plugins,
    serverAction,
    sudo,
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
export function populateDbDelegate<TPrisma extends PrismaClientLike>(
  target: Record<string, unknown>,
  config: OpenSaasConfig,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
): void {
  for (const [listName, listConfig] of Object.entries(config.lists)) {
    const dbKey = getDbKey(listName)

    // Create base operations
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
      count: createCount(listName, listConfig, prisma, context),
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

    // Add get() method for singleton lists
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
export function buildDbDelegate<TPrisma extends PrismaClientLike>(
  config: OpenSaasConfig,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
): AccessControlledDB<TPrisma> {
  const db: Record<string, unknown> = {}
  populateDbDelegate(db, config, prisma, context)
  return db as AccessControlledDB<TPrisma>
}

/**
 * Create findUnique operation with access control
 */
function createFindUnique<TPrisma extends PrismaClientLike>(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
  config: OpenSaasConfig,
) {
  return async (args: {
    // Accepts any unique selector at the delegate level (the generated
    // `<List>FindUniqueArgs` type narrows `where` to Prisma's `WhereUniqueInput`).
    // The runtime guard below rejects non-unique shapes.
    where: Record<string, unknown>
    include?: Record<string, unknown>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query?: any
    // `select` is not honoured — accepted only so the no-op can be made visible.
    select?: Record<string, unknown>
  }) => {
    // `select` is a visible no-op: warn, then proceed with include/query narrowing.
    warnIfSelectIgnored(args, listName, 'findUnique')

    // Enforce unique-`where` (Keystone `findOne` parity). This is a caller-shape
    // check independent of access, so it runs first and THROWS on misuse — it is
    // not an access denial and must not be masked as a silent `null`. The
    // type-level constraint already lives on the generated delegate: the custom
    // `<List>FindUniqueArgs` only Omits `select`/`include` from
    // `Prisma.<List>FindUniqueArgs`, so its `where` stays Prisma's
    // `<List>WhereUniqueInput` — this runtime guard backstops untyped callers.
    assertUniqueWhere(args.where, getUniqueWhereKeys(listConfig), listName)

    // Check query access (skip if sudo mode)
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

      // Merge access filter with where clause
      const mergedWhere = mergeFilters(args.where, accessResult)
      if (mergedWhere === null) {
        return null
      }
      where = mergedWhere
    }

    // When a query fragment is provided, build the include from the fragment
    // instead of the access-controlled include. Access control still runs via
    // filterReadableFields; the fragment then narrows to only the requested fields.
    const fragment = isFragment(args.query) ? args.query : null
    let include: Record<string, unknown> | undefined

    if (fragment) {
      include = buildInclude(fragment._fields) ?? undefined
    } else if (context._isSudo) {
      // Sudo bypasses access control entirely — the caller's include is trusted
      // and used as-is (matching the prior behaviour); no per-relation filtering.
      include = args.include
    } else {
      // Build include with access control filters
      const accessControlledInclude = await buildIncludeWithAccessControl(
        listConfig.fields,
        {
          session: context.session,
          context,
        },
        config,
        0,
        // Seed the cycle guard with the root list so a relationship cycle back
        // to it (self-referential or longer) stops re-descending.
        [listName],
      )
      // MERGE (not replace) a caller-supplied include with the access-controlled
      // include: the caller selects WHICH relations to fetch, access control
      // decides WHETHER and WITH WHAT filter (#566). A bare auto-include (no
      // caller include) still uses the access-controlled include directly.
      include = args.include
        ? mergeIncludeWithAccessControl(
            args.include,
            accessControlledInclude,
            listConfig.fields,
            config,
          )
        : accessControlledInclude
    }

    // Virtual fields have no database column. Whichever path produced
    // `include` (fragment, access-controlled merge, or sudo passthrough), a
    // virtual key must never reach Prisma — it would throw "Unknown field"
    // (#628). The virtual value is still computed unconditionally below by
    // `filterReadableFields`, independent of what was requested here.
    include = stripVirtualFieldsFromInclude(include, listConfig.fields, config)

    // Execute query with optimized includes
    // Access Prisma model dynamically - required because model names are generated at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (prisma as any)[getDbKey(listName)]
    const item = await model.findFirst({
      where,
      include,
    })

    if (!item) {
      return null
    }

    // Filter readable fields and apply resolveOutput hooks (including nested relationships)
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
    )

    // When a fragment is provided, pick only the requested fields from the result
    if (fragment) {
      return pickFields(filtered, fragment._fields)
    }

    return filtered
  }
}

/**
 * Create findMany operation with access control
 */
function createFindMany<TPrisma extends PrismaClientLike>(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
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
    // `select` is a visible no-op: warn, then proceed with include/query narrowing.
    warnIfSelectIgnored(args, listName, 'findMany')

    // Check singleton constraint (throw error instead of silently returning empty)
    if (isSingletonList(listConfig)) {
      throw new ValidationError(
        [`Cannot use findMany: ${listName} is a singleton list. Use get() instead.`],
        {},
      )
    }

    // Check query access (skip if sudo mode)
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

      // Merge access filter with where clause
      const mergedWhere = mergeFilters(args?.where, accessResult)
      if (mergedWhere === null) {
        return []
      }
      where = mergedWhere
    }

    // When a query fragment is provided, build include from fragment fields
    const fragment = isFragment(args?.query) ? args.query : null
    let include: Record<string, unknown> | undefined
    if (fragment) {
      include = buildInclude(fragment._fields) ?? undefined
    } else if (context._isSudo) {
      // Sudo bypasses access control entirely — the caller's include is trusted
      // and used as-is (matching the prior behaviour); no per-relation filtering.
      include = args?.include
    } else {
      // Build include with access control filters
      const accessControlledInclude = await buildIncludeWithAccessControl(
        listConfig.fields,
        {
          session: context.session,
          context,
        },
        config,
        0,
        // Seed the cycle guard with the root list so a relationship cycle back
        // to it (self-referential or longer) stops re-descending.
        [listName],
      )
      // MERGE (not replace) a caller-supplied include with the access-controlled
      // include: the caller selects WHICH relations to fetch, access control
      // decides WHETHER and WITH WHAT filter (#566). A bare auto-include (no
      // caller include) still uses the access-controlled include directly.
      include = args?.include
        ? mergeIncludeWithAccessControl(
            args.include,
            accessControlledInclude,
            listConfig.fields,
            config,
          )
        : accessControlledInclude
    }

    // Virtual fields have no database column. Whichever path produced
    // `include` (fragment, access-controlled merge, or sudo passthrough), a
    // virtual key must never reach Prisma — it would throw "Unknown field"
    // (#628). The virtual value is still computed unconditionally below by
    // `filterReadableFields`, independent of what was requested here.
    include = stripVirtualFieldsFromInclude(include, listConfig.fields, config)

    // Execute query with optimized includes
    // Access Prisma model dynamically - required because model names are generated at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (prisma as any)[getDbKey(listName)]
    const items = await model.findMany({
      where,
      orderBy: args?.orderBy,
      take: args?.take,
      skip: args?.skip,
      include,
    })

    // Filter readable fields for each item and apply resolveOutput hooks (including nested relationships)
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
        ),
      ),
    )

    // When a fragment is provided, pick only the requested fields from each result
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

/**
 * Create create operation with access control and hooks
 */
function createCreate<TPrisma extends PrismaClientLike>(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
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

/**
 * Create createMany operation with access control and hooks
 * Runs create in a loop to ensure all hooks and access control are executed for each item
 */
function createCreateMany<TPrisma extends PrismaClientLike>(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
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

/**
 * Create update operation with access control and hooks
 */
function createUpdate<TPrisma extends PrismaClientLike>(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
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

/**
 * Create updateMany operation with access control and hooks
 * Runs findMany to get records, then update in a loop to ensure all hooks and access control are executed
 */
function createUpdateMany<TPrisma extends PrismaClientLike>(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
  config: OpenSaasConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findManyFn: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateFn: any,
) {
  return async (args: { where?: Record<string, unknown>; data: Record<string, unknown> }) => {
    // First, find all matching records (respects access control)
    const items = await findManyFn({ where: args.where })

    // Then update each one individually (runs hooks and access control for each)
    const results = []
    for (const item of items) {
      const result = await updateFn({ where: { id: item.id }, data: args.data })
      results.push(result)
    }

    return results
  }
}

/**
 * Create delete operation with access control and hooks
 */
function createDelete<TPrisma extends PrismaClientLike>(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
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

/**
 * Create count operation with access control
 */
function createCount<TPrisma extends PrismaClientLike>(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
) {
  return async (args?: { where?: Record<string, unknown> }) => {
    // Check query access (skip if sudo mode)
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

      // Merge access filter with where clause
      const mergedWhere = mergeFilters(args?.where, accessResult)
      if (mergedWhere === null) {
        return 0
      }
      where = mergedWhere
    }

    // Execute count
    // Access Prisma model dynamically - required because model names are generated at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (prisma as any)[getDbKey(listName)]
    const count = await model.count({
      where,
    })

    return count
  }
}

/**
 * Create get operation for singleton lists
 * Returns the single record, or auto-creates it if enabled
 */
function createGet<TPrisma extends PrismaClientLike>(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
  config: OpenSaasConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createFn: any,
) {
  return async () => {
    // First try to find the existing record
    // Access Prisma model dynamically - required because model names are generated at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (prisma as any)[getDbKey(listName)]

    // Check query access (skip if sudo mode)
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

      // Merge access filter (for singleton, we don't have a specific where clause)
      if (accessResult && typeof accessResult === 'object') {
        where = accessResult
      }
    }

    // Build include with access control filters
    const accessControlledInclude = await buildIncludeWithAccessControl(
      listConfig.fields,
      {
        session: context.session,
        context,
      },
      config,
      0,
      // Seed the cycle guard with the root list so a relationship cycle back
      // to it (self-referential or longer) stops re-descending.
      [listName],
    )

    // Try to find the record
    const item = await model.findFirst({
      where,
      include: accessControlledInclude,
    })

    // If record exists, return it
    if (item) {
      // Filter readable fields and apply resolveOutput hooks
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
      )
      return filtered
    }

    // If no record and auto-create is enabled, create it
    if (shouldAutoCreate(listConfig)) {
      const defaultData = getDefaultData(listConfig)
      return await createFn({ data: defaultData })
    }

    // No record and auto-create is disabled
    return null
  }
}
