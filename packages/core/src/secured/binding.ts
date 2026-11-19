// What a secured read is bound to, and the Prisma 8 collection it drives. Shared
// by the read and by Field Visibility, which issues its own engine reads.

import type { AnyExpression, OrderByItem } from '@prisma/orm-postgres/relational-core'
import type { OpenSaasConfig, ListConfig, TypeInfo } from '../config/types.js'
import type { AccessContext, AccessControlledDB, OrmClient, OrmRow } from '../access/types.js'
import { withOrigin } from '../origin.js'
import { unqueryableKey } from './vocabulary.js'
import type { PredicateAccessor } from './lower.js'
import type { RowLockKey, RowLockLane } from './lock.js'

export interface ReadBinding {
  listName: string
  listConfig: ListConfig<TypeInfo>
  ormHandle: OrmClient
  context: AccessContext
  config: OpenSaasConfig
  /**
   * Builds `context.db` for a `resolveOutput` hook's derived context, so a read
   * the hook issues carries the hook's own resolve chain (ADR-0023).
   */
  rebindDb: (derived: AccessContext) => AccessControlledDB
  /**
   * Present only on a context bound to a transaction, which is what makes
   * `forUpdate()` answerable there and a refusal everywhere else (ADR-0047).
   */
  lock?: RowLockLane
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

/**
 * The part of a Prisma 8 collection the read path drives, structurally.
 * `where` appends a predicate — repeated calls are AND-combined by the ORM,
 * which is what makes the Access Filter a second entry rather than a merge.
 */
export interface RefinableCollection {
  select(...fields: readonly string[]): RefinableCollection
  where(predicate: (model: PredicateAccessor) => AnyExpression): RefinableCollection
  orderBy(selection: readonly ((model: PredicateAccessor) => OrderByItem)[]): RefinableCollection
  limit(count: number): RefinableCollection
  offset(count: number): RefinableCollection
  include(name: string, refine: (child: RefinableCollection) => IncludeBranch): RefinableCollection
  /** The relation reads as how many rows matched, rather than as the rows. */
  count(): IncludeReduction
  /** Several named reductions over the same relation, each its own subquery. */
  combine(spec: Record<string, IncludeBranch>): IncludeReduction
}

/**
 * What an include's refinement callback may hand back to the ORM: a composed
 * child collection, or the reduction that replaces it.
 */
export type IncludeBranch = RefinableCollection | IncludeReduction

/** The ORM's reduced-relation value. Opaque here; only the ORM reads it. */
interface IncludeReduction {
  readonly reduced?: never
}

/** What a bare aggregate spec names on the ORM's aggregate accessor. */
export interface AggregateAccessor {
  count(): AggregateReduction
}

interface AggregateReduction {
  readonly aggregated?: never
}

export interface ReadableCollection extends RefinableCollection {
  select(...fields: readonly string[]): ReadableCollection
  where(predicate: (model: PredicateAccessor) => AnyExpression): ReadableCollection
  orderBy(selection: readonly ((model: PredicateAccessor) => OrderByItem)[]): ReadableCollection
  include(name: string, refine: (child: RefinableCollection) => IncludeBranch): ReadableCollection
  limit(rows: number): ReadableCollection
  offset(rows: number): ReadableCollection
  distinct(...fields: string[]): ReadableCollection
  distinctOn(...fields: string[]): ReadableCollection
  cursor(values: Record<string, unknown>): ReadableCollection
  all(): PromiseLike<OrmRow[]>
  first(): Promise<OrmRow | null>
  aggregate(
    build: (aggregate: AggregateAccessor) => Record<string, AggregateReduction>,
  ): Promise<Record<string, unknown>>
}

/**
 * Presence, not completeness — the same rule `isDelegate` states in
 * `access/orm-client.ts`, and for the same reason. A test double implements
 * only the operations its test reaches, so requiring the full set would refuse
 * a client the engine can drive, and would refuse it with advice ("re-run
 * `opensaas generate`") that does not describe what is actually wrong. A
 * member that is genuinely absent surfaces at its own call site.
 */
function isReadableCollection(value: unknown): value is ReadableCollection {
  return typeof value === 'object' && value !== null
}

export function collectionFor(ormHandle: OrmClient, listName: string): ReadableCollection {
  const collection = ormHandle[listName]
  if (!isReadableCollection(collection)) throw new SecuredCollectionMissingError(listName)
  return collection
}

/** The `id IN (...)` predicate a batched existence check narrows its scan to. */
export function identityIn(
  model: PredicateAccessor,
  listName: string,
  keys: readonly RowLockKey[],
  column = 'id',
): AnyExpression {
  const expression = model[column]?.in?.(keys)
  if (expression === undefined) throw unqueryableKey(listName, column)
  return expression
}

export async function engineRead<T>(
  binding: Pick<ReadBinding, 'context'>,
  run: () => PromiseLike<T>,
): Promise<T> {
  try {
    return await withOrigin('engine', run)
  } catch (error) {
    binding.context._transactionOwner?.poison(error)
    throw error
  }
}
