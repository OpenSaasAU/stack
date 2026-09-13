import type { FilterCondition, FilterSpec, FilterToken } from './types.js'

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
 * Map parsed {@link FilterToken}s to a single Prisma `where` fragment, given the
 * fields' {@link FilterSpec}s (ADR-0017).
 *
 * Pure — no DB/Prisma imports. This is the unit-tested half of the filter seam.
 * Tokens combine with implicit AND. A token degrades to free text (never an
 * error) when its field is unknown, has no spec, uses an unsupported operator,
 * has an empty value, or maps to `null`. Bare words (and degraded tokens) are
 * OR-matched across every free-text field, and each such word is ANDed with the
 * rest — so `beta gamma` requires both. A word that reaches this stage but
 * cannot be matched against any free-text field — because the list has none,
 * or because every free-text field's own mapping rejects it — narrows the
 * chain to {@link NEVER_MATCHES} instead of being dropped: a condition that
 * cannot be honoured must never widen the result set (#1356).
 *
 * @param tokens Parsed tokens from {@link parseFilterQuery}.
 * @param specs  Field-name → Filter spec (from {@link collectFilterSpecs}).
 * @returns A Prisma `where` fragment, or `undefined` when nothing filters.
 */
export function buildFilterWhere(
  tokens: FilterToken[],
  specs: Record<string, FilterSpec>,
): FilterCondition | undefined {
  const andConditions: FilterCondition[] = []
  const freeTextWords: string[] = []

  const freeTextFields = Object.keys(specs).filter((field) => specs[field].freeText)

  for (const token of tokens) {
    if (token.field === null) {
      if (token.value) freeTextWords.push(token.value)
      continue
    }

    const spec = specs[token.field]

    if (!spec || !spec.operators.includes(token.operator) || token.value === '') {
      if (token.value) freeTextWords.push(token.value)
      continue
    }

    const condition = spec.toCondition(token.operator, token.value)
    if (condition === null) {
      freeTextWords.push(token.value)
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
