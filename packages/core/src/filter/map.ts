import { parseFilterQuery } from './parse.js'
import { serializeFilterToken } from './serialize.js'
import type {
  FilterCondition,
  FilterFieldSuggestion,
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

/** What {@link isFieldConditionToken} needs to know about a field. */
export type FilterFieldCapabilities = Pick<FilterFieldSuggestion, 'operators' | 'canBeEmpty'>

/**
 * Whether a {@link FilterToken} was written with no characters at all (`role:`,
 * `""`, `a:,`, or no values). Such a token is incomplete input and filters
 * nothing (#1509). An `empty` token (`field:!`) carries no values and is not one.
 */
export function isEmptyFilterToken(token: FilterToken): boolean {
  return token.operator !== 'empty' && token.values.every((value) => value.text === '')
}

/**
 * Whether a {@link FilterToken} is a field condition the engine maps through
 * its field's Filter spec: not empty, and naming a field that, as `fieldFor`
 * reports it, supports the token's operator, or can be empty for an `empty`
 * token. Negation and several values are composed around the field's own
 * condition, so neither decides this. Any other token is searched as free text.
 */
export function isFieldConditionToken(
  token: FilterToken,
  fieldFor: (field: string) => FilterFieldCapabilities | undefined,
): token is FilterToken & { field: string } {
  if (token.field === null || isEmptyFilterToken(token)) return false
  const capabilities = fieldFor(token.field)
  if (!capabilities) return false
  return token.operator === 'empty'
    ? capabilities.canBeEmpty === true
    : capabilities.operators.includes(token.operator)
}

/**
 * The one free-text word a {@link FilterToken} is searched as when it cannot
 * map to a field condition, and the text the Filter builder's chip shows for it.
 *
 * - A positive field token searches its values, written as one comma list
 *   with the field name dropped: `nosuchfield:Findable` is `Findable`, and
 *   `status:draft,bogus` is `draft,bogus`.
 * - A negated token, or a `field:!`, searches its whole serialised literal
 *   (`-secret:x`), so a token that cannot map is never negated.
 * - A bare word searches its own text.
 */
export function filterTokenFreeTextWord(token: FilterToken): string {
  if (token.negated || token.operator === 'empty') return serializeFilterToken(token)
  return token.values
    .map((value) => value.text)
    .filter((text) => text !== '')
    .join(',')
}

function anyOf(conditions: FilterCondition[]): FilterCondition {
  return conditions.length === 1 ? conditions[0] : { OR: conditions }
}

function fieldCondition(token: FilterToken, spec: FilterSpec): FilterCondition | null {
  if (token.operator === 'empty') {
    if (spec.empty === undefined) return null
    return token.negated ? { NOT: spec.empty } : spec.empty
  }
  if (!spec.operators.includes(token.operator)) return null
  const operator = token.operator
  const conditions: FilterCondition[] = []
  for (const value of token.values) {
    if (value.text === '') continue
    const condition = spec.toCondition(operator, value.text)
    if (condition === null) return null
    conditions.push(condition)
  }
  if (conditions.length === 0) return null
  const matched = anyOf(conditions)
  if (!token.negated) return matched
  const excluded: FilterCondition = { NOT: matched }
  return spec.empty === undefined || spec.negation !== undefined
    ? excluded
    : { OR: [excluded, spec.empty] }
}

/**
 * Map a parsed {@link FilterQuery} to a single Where fragment, given the
 * fields' {@link FilterSpec}s (ADR-0017, ADR-0083).
 *
 * Pure — no DB/Prisma imports. This is the unit-tested half of the filter seam.
 * Terms combine with implicit AND. An empty token is a deliberate no-op —
 * incomplete input expresses no constraint, so it contributes nothing and is
 * never handed to a free-text field (#1509), and an empty value inside a list
 * (`a:x,`) is skipped the same way.
 *
 * The engine composes around each field's own `toCondition`:
 *
 * - `field:a,b` ORs the field's condition once per value.
 * - `-field:value` is `NOT` of that condition, ORed with the field's `empty`
 *   condition when it states one, so "is not" keeps the rows with no value.
 *   A spec stating a `negation` says `NOT` alone already does, and gets no `OR`.
 * - `field:!` is the field's `empty` condition and `-field:!` its `NOT`.
 *
 * A token that cannot map in any part (an unknown or unreadable field, an
 * unsupported operator, a value the field rejects, any one value of a list, or
 * `field:!` on a field that cannot be empty) is searched as one free-text word,
 * {@link filterTokenFreeTextWord}, which is also what the Filter builder's chip
 * shows. A positive token searches its values with the field name dropped
 * (`status:draft,bogus` searches `draft,bogus`); a negated one searches its
 * whole literal (`-secret:x`) and is never negated, because `NOT` of free text
 * would turn a field the session cannot read into a filter. A free-text token
 * is read as its serialised form reads back, so a structured one with several
 * values is the words its URL holds.
 *
 * Bare words (and degraded tokens) are OR-matched across every free-text
 * field, and each such word is ANDed with the rest — so `beta gamma` requires
 * both. A word that cannot be matched against any free-text field — because
 * the list has none, or because every free-text field's own mapping rejects
 * it — narrows the chain to {@link NEVER_MATCHES} instead of being dropped: a
 * condition that cannot be honoured must never widen the result set (#1356).
 *
 * @param query The structured query from {@link parseFilterQuery}.
 * @param specs Field-name → Filter spec (from {@link collectFilterSpecs}).
 * @returns A Where fragment, or `undefined` when nothing filters.
 */
export function buildFilterWhere(
  query: FilterQuery,
  specs: Record<string, FilterSpec>,
): FilterCondition | undefined {
  const fieldConditions: FilterCondition[] = []
  const textConditions: FilterCondition[] = []

  const freeTextFields = Object.keys(specs).filter((field) => specs[field].freeText)
  const specFor = (field: string): FilterSpec | undefined =>
    Object.hasOwn(specs, field) ? specs[field] : undefined

  const freeText = (word: string): FilterCondition => {
    const conditions = freeTextFields
      .map((field) => specs[field].toCondition('eq', word))
      .filter((condition): condition is FilterCondition => condition !== null)
    return conditions.length > 0 ? anyOf(conditions) : NEVER_MATCHES
  }

  const terms = query.terms.flatMap((token) =>
    token.field === null ? parseFilterQuery(serializeFilterToken(token)).terms : [token],
  )

  for (const token of terms) {
    // An empty value is incomplete input, not a constraint the engine failed
    // to honour: `role:` (or a bare `""`) says nothing to filter on, so it is
    // inert by design rather than narrowed away (#1509). This must be checked
    // before a token ever reaches the free-text path — an empty value there
    // would call `toCondition('eq', '')`, and a `contains`-style mapping over
    // `''` matches every row, not none. That is the opposite of #1356's
    // narrow-on-failure rule, which only ever applies to a token that DOES
    // carry a value the system cannot compile.
    if (isEmptyFilterToken(token)) continue

    const spec = token.field === null ? undefined : specFor(token.field)
    const condition = spec === undefined ? null : fieldCondition(token, spec)
    if (condition !== null) {
      fieldConditions.push(condition)
      continue
    }
    textConditions.push(freeText(filterTokenFreeTextWord(token)))
  }

  const andConditions = [...fieldConditions, ...textConditions]
  if (andConditions.length === 0) return undefined
  if (andConditions.length === 1) return andConditions[0]
  return { AND: andConditions }
}
