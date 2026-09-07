// The secured write surface's ORM lane: the part of a Prisma 8 collection the
// Write Pipeline drives, and the statements it issues. Reads compose through
// `read.ts`; a write composes here, over the same lowered predicates, so the
// Access Filter reaches an `UPDATE` the way it reaches a `SELECT`.
// See ADR-0044, ADR-0050, ADR-0059.

import type { AnyExpression } from '@prisma/orm-postgres/relational-core'
import type { OrmClient, OrmRow } from '../access/types.js'
import { ValidationError } from '../hooks/index.js'
import { withOrigin } from '../origin.js'
import { lowerWhere, type PredicateAccessor, type WhereCombinators } from './lower.js'
import type { WherePlan } from './vocabulary.js'

export { whereCombinators } from './lower.js'
export type { WhereCombinators } from './lower.js'

/** What a bare aggregate spec names on the ORM's aggregate accessor. */
interface AggregateAccessor {
  count(): AggregateReduction
}

interface AggregateReduction {
  readonly aggregated?: never
}

/**
 * The part of a Prisma 8 collection a write drives, structurally.
 *
 * `where` appends a predicate — repeated calls are AND-combined by the ORM,
 * which is what makes the Access Filter a second entry beside the target's own
 * rather than something hand-merged into it (ADR-0044). `update` and `delete`
 * answer `null` when nothing matched, which is how a row that vanished between
 * the target read and the write reaches the pipeline.
 */
export interface WriteCollection {
  where(predicate: (model: PredicateAccessor) => AnyExpression): WriteCollection
  first(): Promise<OrmRow | null>
  aggregate(
    build: (aggregate: AggregateAccessor) => Record<string, AggregateReduction>,
  ): Promise<Record<string, unknown>>
  create(data: Record<string, unknown>): Promise<OrmRow>
  update(data: Record<string, unknown>): Promise<OrmRow | null>
  delete(): Promise<OrmRow | null>
}

/**
 * Presence, not completeness — the same rule `isReadableCollection` states in
 * `read.ts`. A test double implements only the operations its test reaches, so
 * requiring the full set would refuse a client the engine can drive; a member
 * that is genuinely absent surfaces at its own call site.
 */
function isWriteCollection(value: unknown): value is WriteCollection {
  return typeof value === 'object' && value !== null
}

/**
 * Thrown when the ORM client carries no collection for a list the config
 * declares — a generation or wiring fault rather than an access denial, so it
 * is reported rather than silently treated as a denied write.
 */
export class WriteCollectionMissingError extends Error {
  constructor(readonly listName: string) {
    super(
      `The ORM client has no collection for list "${listName}" to write through. Re-run ` +
        `\`opensaas generate\` so the emitted contract matches the config.`,
    )
    this.name = 'WriteCollectionMissingError'
  }
}

export function writeCollection(ormHandle: OrmClient, listName: string): WriteCollection {
  const collection = ormHandle[listName]
  if (!isWriteCollection(collection)) throw new WriteCollectionMissingError(listName)
  return collection
}

/**
 * The predicate a write runs under: the engine's own target predicate, and the
 * Access Filter beside it when the list's rule returned one. Each entry is its
 * own `where` call, so the ORM ANDs them.
 */
export type WriteScope = readonly WherePlan[]

/** The engine's own `id = <value>` predicate for a targeted write. */
export function identityPredicate(listName: string, id: string | number): WherePlan {
  return { kind: 'scalar', listName, column: 'id', steps: [{ op: 'eq', value: id }] }
}

function scoped(
  collection: WriteCollection,
  scope: WriteScope,
  ops: WhereCombinators,
): WriteCollection {
  let composed = collection
  for (const plan of scope) {
    composed = composed.where((model) => lowerWhere(plan, model, ops))
  }
  return composed
}

/** The first row this scope matches, or `null` — the write's target read. */
export function firstMatching(
  collection: WriteCollection,
  scope: WriteScope,
  ops: WhereCombinators,
): Promise<OrmRow | null> {
  return withOrigin('engine', () => scoped(collection, scope, ops).first())
}

/** How many rows the list holds. Only a singleton's constraint asks. */
export async function countRows(collection: WriteCollection, listName: string): Promise<number> {
  const result = await withOrigin('engine', () =>
    collection.aggregate((aggregate) => ({ rows: aggregate.count() })),
  )
  const rows = result.rows
  if (typeof rows !== 'number') {
    throw new ValidationError([
      `The database answered a count of "${listName}" with something other than a number. ` +
        `Re-run \`opensaas generate\` so the emitted contract matches the config.`,
    ])
  }
  return rows
}

export function insertRow(
  collection: WriteCollection,
  data: Record<string, unknown>,
): Promise<OrmRow> {
  return withOrigin('engine', () => collection.create(data))
}

export function updateFirst(
  collection: WriteCollection,
  scope: WriteScope,
  ops: WhereCombinators,
  data: Record<string, unknown>,
): Promise<OrmRow | null> {
  return withOrigin('engine', () => scoped(collection, scope, ops).update(data))
}

export function deleteFirst(
  collection: WriteCollection,
  scope: WriteScope,
  ops: WhereCombinators,
): Promise<OrmRow | null> {
  return withOrigin('engine', () => scoped(collection, scope, ops).delete())
}
