import type { RefinableCollection } from './binding.js'
import type { IncludePlan } from './include.js'
import { lowerWhere, type WhereCombinators } from './lower.js'
import type { WherePlan } from './vocabulary.js'

/**
 * The rows a declaring hook is owed, apart from the caller's own view of the
 * relation: the Access Filter alone, full stored width, and the declared
 * relations beneath (ADR-0051, ADR-0085).
 */
export function declaredBranch(
  collection: RefinableCollection,
  predicates: readonly WherePlan[],
  includes: readonly IncludePlan[],
  ops: WhereCombinators,
): RefinableCollection {
  let branch = collection
  for (const predicate of predicates) {
    branch = branch.where((model) => lowerWhere(predicate, model, ops))
  }
  for (const nested of includes) {
    branch = branch.include(nested.relation, (child) =>
      declaredBranch(child, nested.predicates, nested.includes, ops),
    )
  }
  return branch
}
