import { serializeFilterToken } from './serialize.js'
import type {
  FilterCondition,
  FilterOperator,
  FilterQuery,
  FilterSpec,
  FilterToken,
} from './types.js'

/**
 * A Where fragment an `AND` chain can carry that never matches a row. `NOT`
 * on an empty predicate: the empty predicate resolves to the vacuous,
 * always-true `AND ()`, and negating it lowers to `ops.all().not()` —
 * always-false by construction, though a different `WherePlan` shape than
 * the `{ kind: 'false' }` a denied relation's Access Filter produces
 * (`resolveRelatedAccessPlan`), which evaluates false the same way without
 * going through `NOT`. Used for a word that survives to the free-text stage
 * but still can't be turned into a real condition, so the chain narrows to
 * nothing rather than silently dropping a term and widening the result.
 */
const NEVER_MATCHES: FilterCondition = { NOT: {} }

/**
 * Whether a {@link FilterToken} carries no value at all (`role:`, `""`,
 * `-role:`). Such a token is incomplete input and filters nothing (#1509).
 */
export function isEmptyFilterToken(token: FilterToken): boolean {
  return token.values.every((value) => value === '')
}

/**
 * Whether a {@link FilterToken} is a field condition the engine maps through
 * its field's Filter spec: not empty, not negated, and naming a field whose
 * operators, as `operatorsFor` reports them, include the token's own. Any other
 * token is searched as free text.
 */
export function isFieldConditionToken(
  token: FilterToken,
  operatorsFor: (field: string) => readonly FilterOperator[] | undefined,
): token is FilterToken & { field: string } {
  if (token.field === null || token.negated || isEmptyFilterToken(token)) return false
  return operatorsFor(token.field)?.includes(token.operator) ?? false
}

/**
 * Map a parsed {@link FilterQuery} to a single Where fragment, given the
 * fields' {@link FilterSpec}s (ADR-0017).
 *
 * Pure — no DB/Prisma imports. This is the unit-tested half of the filter seam.
 * Terms combine with implicit AND. An empty token, negated or not, is a
 * deliberate no-op — incomplete input expresses no constraint, so it
 * contributes nothing and is never handed to a free-text field (#1509). A
 * negated token is searched as the literal word it serialises to, and a token
 * with several values as the comma-joined value it was written as. A token
 * degrades to free text (never an error) when its field is unknown, has no
 * spec, uses an unsupported operator, or maps to `null`. Bare words (and
 * degraded tokens) are OR-matched across every free-text field, and each such
 * word is ANDed with the rest — so `beta gamma` requires both. A word that
 * reaches this stage but cannot be matched against any free-text field —
 * because the list has none, or because every free-text field's own mapping
 * rejects it — narrows the chain to {@link NEVER_MATCHES} instead of being
 * dropped: a condition that cannot be honoured must never widen the result set
 * (#1356).
 *
 * @param query The structured query from {@link parseFilterQuery}.
 * @param specs Field-name → Filter spec (from {@link collectFilterSpecs}).
 * @returns A Where fragment, or `undefined` when nothing filters.
 */
export function buildFilterWhere(
  query: FilterQuery,
  specs: Record<string, FilterSpec>,
): FilterCondition | undefined {
  const andConditions: FilterCondition[] = []
  const freeTextWords: string[] = []

  const freeTextFields = Object.keys(specs).filter((field) => specs[field].freeText)
  const specFor = (field: string): FilterSpec | undefined =>
    Object.hasOwn(specs, field) ? specs[field] : undefined

  for (const token of query.terms) {
    // An empty value is incomplete input, not a constraint the engine failed
    // to honour: `role:` (or a bare `""`) says nothing to filter on, so it is
    // inert by design rather than narrowed away (#1509). This must be checked
    // before a token ever reaches `freeTextWords` — an empty value degrading
    // through the free-text path would call `toCondition('eq', '')`, and a
    // `contains`-style mapping over `''` matches every row, not none. That is
    // the opposite of #1356's narrow-on-failure rule, which only ever applies
    // to a token that DOES carry a value the system cannot compile.
    if (isEmptyFilterToken(token)) continue

    if (token.negated) {
      freeTextWords.push(serializeFilterToken(token))
      continue
    }

    const value = token.values.join(',')
    if (!isFieldConditionToken(token, (field) => specFor(field)?.operators)) {
      freeTextWords.push(value)
      continue
    }

    const spec = specFor(token.field)
    const condition = spec ? spec.toCondition(token.operator, value) : null
    if (condition === null) {
      freeTextWords.push(value)
      continue
    }

    andConditions.push(condition)
  }

  for (const word of freeTextWords) {
    const orConditions = freeTextFields
      .map((field) => specs[field].toCondition('eq', word))
      .filter((condition): condition is FilterCondition => condition !== null)
    if (orConditions.length > 0) {
      andConditions.push(orConditions.length === 1 ? orConditions[0] : { OR: orConditions })
    } else {
      andConditions.push(NEVER_MATCHES)
    }
  }

  if (andConditions.length === 0) return undefined
  if (andConditions.length === 1) return andConditions[0]
  return { AND: andConditions }
}
