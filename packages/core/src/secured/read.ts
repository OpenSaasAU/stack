// The secured read surface: `context.db.<List>` as an opaque wrapper over a
// Prisma 8 collection, its `where` composition, and the `all()`/`first()`
// terminals the engine owns. See ADR-0041, ADR-0044, ADR-0046 and ADR-0058.

import type { OpenSaasConfig, ListConfig } from '../config/types.js'
import type { AccessContext, OrmClient, OrmRow, PrismaFilter, Session } from '../access/types.js'
import {
  checkAccess,
  filterReadableFields,
  validateQueryKeys,
  validateQueryFieldReadAccess,
} from '../access/index.js'
import { withOrigin } from '../origin.js'

/** A value a predicate compares a column against. */
export type WhereValue = string | number | boolean | bigint | Date | null

/** One column's condition: the value itself, or an explicit `equals`. */
export type WhereCondition = WhereValue | { equals: WhereValue }

/**
 * A predicate over a list's own columns.
 *
 * Equality only. The closed Where vocabulary — `in`, `not`, the comparisons,
 * `contains`, the logical combinators and the relation quantifiers — is
 * ADR-0055's, and {@link lowerPredicate} refuses everything it does not yet
 * lower rather than passing it to the ORM unscoped.
 */
export type Where = { [column: string]: WhereCondition }

/**
 * A composed read: an immutable value carrying the list, the predicates and
 * nothing that can execute unscoped. `where` returns a new value; the
 * terminals are the only way to reach the database.
 *
 * Rows are untyped here for the same reason the rest of the engine's own view
 * is: the per-list shapes live in the generated bundle, which instantiates
 * `SecuredList` from the emitted contract (ADR-0052).
 */
export interface SecuredQuery<TRow = OrmRow> {
  /** Narrow the read. Composes; nothing is enforced until a terminal runs. */
  where(predicate: Where): SecuredQuery<TRow>
  /** Every row this session may see. `[]` when the read is denied. */
  all(): Promise<TRow[]>
  /** The first row this session may see, or `null` — denied or absent alike. */
  first(): Promise<TRow | null>
}

/**
 * Thrown when a predicate names an operator the engine does not lower.
 *
 * A predicate can only ever narrow, so an unrecognised operator is refused
 * rather than dropped: dropping it would widen the read (ADR-0055).
 */
export class UnsupportedPredicateError extends Error {
  constructor(
    readonly listName: string,
    readonly column: string,
    readonly detail: string,
  ) {
    super(
      `Cannot lower the predicate on "${listName}.${column}": ${detail}. The secured surface ` +
        `takes an equality predicate — \`{ ${column}: value }\` or \`{ ${column}: { equals: value } }\`.`,
    )
    this.name = 'UnsupportedPredicateError'
  }
}

/**
 * Thrown when the ORM client carries no collection for a list the config
 * declares — a generation or wiring fault rather than an access denial, so it
 * is reported rather than silently read as an empty result.
 */
export class SecuredCollectionMissingError extends Error {
  constructor(readonly listName: string) {
    super(
      `The ORM client has no collection for list "${listName}". Re-run \`opensaas generate\` so ` +
        `the emitted contract matches the config.`,
    )
    this.name = 'SecuredCollectionMissingError'
  }
}

/** A filter list entry, as the collection's shorthand `where` takes it. */
type FilterEntry = Record<string, WhereValue>

/**
 * The part of a Prisma 8 collection the read path drives, structurally.
 * `where` appends a filter entry — repeated calls are AND-combined by the ORM,
 * which is what makes the Access Filter a second entry rather than a merge.
 */
interface ReadableCollection {
  where(filter: FilterEntry): ReadableCollection
  all(): PromiseLike<OrmRow[]>
  first(): Promise<OrmRow | null>
}

function isReadableCollection(value: unknown): value is ReadableCollection {
  if (typeof value !== 'object' || value === null) return false
  const candidate: Record<string, unknown> = Object.create(null)
  for (const member of ['where', 'all', 'first']) {
    candidate[member] = Reflect.get(value, member)
    if (typeof candidate[member] !== 'function') return false
  }
  return true
}

function collectionFor(ormHandle: OrmClient, listName: string): ReadableCollection {
  const collection = ormHandle[listName]
  if (!isReadableCollection(collection)) throw new SecuredCollectionMissingError(listName)
  return collection
}

function isWhereValue(value: unknown): value is WhereValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    value instanceof Date
  )
}

function lowerCondition(listName: string, column: string, condition: unknown): WhereValue {
  if (isWhereValue(condition)) return condition
  if (typeof condition !== 'object' || condition === undefined) {
    throw new UnsupportedPredicateError(listName, column, 'the condition is not a value')
  }
  const keys = Object.keys(condition)
  if (keys.length !== 1 || keys[0] !== 'equals') {
    throw new UnsupportedPredicateError(
      listName,
      column,
      `\`${keys.join(', ')}\` is not an operator the engine lowers yet`,
    )
  }
  const value: unknown = Reflect.get(condition, 'equals')
  if (!isWhereValue(value)) {
    throw new UnsupportedPredicateError(listName, column, '`equals` takes a scalar value')
  }
  return value
}

/**
 * Lower one predicate to a single filter entry. Total or throwing, `sudo`
 * included: the Access Filter passes through this too, so a rule the engine
 * cannot lower fails loudly instead of silently widening the read.
 */
export function lowerPredicate(listName: string, predicate: Record<string, unknown>): FilterEntry {
  const entry: FilterEntry = {}
  for (const [column, condition] of Object.entries(predicate)) {
    if (condition === undefined) continue
    entry[column] = lowerCondition(listName, column, condition)
  }
  return entry
}

interface ReadBinding {
  listName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  ormHandle: OrmClient
  context: AccessContext
  config: OpenSaasConfig
}

interface QueryState {
  readonly predicates: readonly Where[]
}

async function resolveAccessFilter(
  binding: ReadBinding,
  state: QueryState,
): Promise<FilterEntry[] | null> {
  const { listName, listConfig, context, config } = binding
  const session: Session | null = context.session
  const lower = (): FilterEntry[] =>
    state.predicates.map((predicate) => lowerPredicate(listName, predicate))

  if (context._isSudo) return lower()

  const access = await checkAccess(listConfig.access?.operation?.query, { session, context })
  if (access === false) return null

  // Runs only once the caller is known to have SOME access to the list: these
  // errors name the offending key, so running them first would tell a caller
  // with no access at all that a field exists and whether it is read-gated
  // (#912, #915).
  for (const predicate of state.predicates) {
    validateQueryKeys({ where: predicate, listConfig, listName, config, isSudo: false })
    await validateQueryFieldReadAccess({
      where: predicate,
      listConfig,
      listName,
      session,
      context,
      isSudo: false,
    })
  }

  if (access === true) return lower()
  const filter: PrismaFilter = access
  return [...lower(), lowerPredicate(listName, filter)]
}

function scope(binding: ReadBinding, entries: readonly FilterEntry[]): ReadableCollection {
  let collection = collectionFor(binding.ormHandle, binding.listName)
  for (const entry of entries) collection = collection.where(entry)
  return collection
}

function visible(binding: ReadBinding, row: OrmRow): Promise<OrmRow> {
  const { listConfig, context, config, listName } = binding
  return filterReadableFields(
    row,
    listConfig.fields,
    { session: context.session, context },
    config,
    0,
    listName,
  )
}

async function runAll(binding: ReadBinding, state: QueryState): Promise<OrmRow[]> {
  const entries = await resolveAccessFilter(binding, state)
  if (entries === null) return []
  const collection = scope(binding, entries)
  const rows = await withOrigin('engine', () => collection.all())
  return await Promise.all(rows.map((row) => visible(binding, row)))
}

async function runFirst(binding: ReadBinding, state: QueryState): Promise<OrmRow | null> {
  const entries = await resolveAccessFilter(binding, state)
  if (entries === null) return null
  const collection = scope(binding, entries)
  const row = await withOrigin('engine', () => collection.first())
  return row === null ? null : await visible(binding, row)
}

function query(binding: ReadBinding, state: QueryState): SecuredQuery {
  return {
    where: (predicate: Where) => query(binding, { predicates: [...state.predicates, predicate] }),
    all: () => runAll(binding, state),
    first: () => runFirst(binding, state),
  }
}

/**
 * The read members of one list's secured surface, bound to `ormHandle` and
 * `context`. The collection is held by the closure and never handed out: no
 * `Collection` and no `CollectionState` is reachable from the returned value
 * or its type (ADR-0041, ADR-0057).
 */
export function createSecuredRead(binding: ReadBinding): SecuredQuery {
  return query(binding, { predicates: [] })
}
