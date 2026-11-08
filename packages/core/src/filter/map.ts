import { filterQueryTokens, parseFilterQuery } from './parse.js'
import { filterValueRecordId } from './record-id.js'
import { serializeFilterQuery, serializeFilterToken } from './serialize.js'
import type {
  FilterCondition,
  FilterFieldSuggestion,
  FilterOperator,
  FilterQuery,
  FilterGroup,
  FilterSpec,
  FilterTerm,
  FilterToken,
  FilterTokenOperator,
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
 * Whether a field whose Filter spec declares `operators` takes an inclusive
 * `range` token: it compares both ways, with `gte` and `lte`.
 */
export function supportsFilterRange(operators: readonly FilterOperator[]): boolean {
  return operators.includes('gte') && operators.includes('lte')
}

/**
 * The token operators a field whose Filter spec declares `operators` accepts
 * on its values: its own, and `range` when it {@link supportsFilterRange}.
 */
export function filterTokenOperators(operators: readonly FilterOperator[]): FilterTokenOperator[] {
  return supportsFilterRange(operators) ? [...operators, 'range'] : [...operators]
}

/**
 * The token a field whose Filter spec declares `operators` actually maps: a
 * `range` token (`field:a..b`) on a field that does not
 * {@link supportsFilterRange} keeps the meaning it had before ranges existed,
 * `eq` on its literal `a..b`, negated or not. Any other token is returned as
 * it is.
 */
export function effectiveFilterToken(
  token: FilterToken,
  operators: readonly FilterOperator[],
): FilterToken {
  if (token.operator !== 'range' || supportsFilterRange(operators)) return token
  const text = token.values.map((value) => value.text).join('..')
  return { ...token, operator: 'eq', values: [{ text, quoted: false }] }
}

/**
 * Whether a {@link FilterToken} is a field condition the engine maps through
 * its field's Filter spec: not empty, and naming a field that, as `fieldFor`
 * reports it, supports the token's operator, or can be empty for an `empty`
 * token. A `range` token needs exactly two non-empty bounds, and on a field
 * that takes no range it is that field's `eq` on the literal `a..b` (see
 * {@link effectiveFilterToken}). Negation and several values are composed
 * around the field's own condition, so neither decides this. Any other token
 * is searched as free text.
 */
export function isFieldConditionToken(
  token: FilterToken,
  fieldFor: (field: string) => FilterFieldCapabilities | undefined,
): token is FilterToken & { field: string } {
  if (token.field === null || isEmptyFilterToken(token)) return false
  const capabilities = fieldFor(token.field)
  if (!capabilities) return false
  if (token.operator === 'empty') return capabilities.canBeEmpty === true
  if (token.operator !== 'range') return capabilities.operators.includes(token.operator)
  if (token.values.length !== 2 || token.values.some((value) => value.text === '')) return false
  return supportsFilterRange(capabilities.operators) || capabilities.operators.includes('eq')
}

/**
 * The one free-text word a {@link FilterToken} is searched as when it cannot
 * map to a field condition, and the text the Filter builder's chip shows for it.
 *
 * - A positive field token searches its values, written as one comma list
 *   with the field name dropped: `nosuchfield:Findable` is `Findable`, and
 *   `status:draft,bogus` is `draft,bogus`. A positive `range` token searches
 *   its literal `a..b`.
 * - A negated token, or a `field:!`, searches its whole serialised literal
 *   (`-secret:x`), so a token that cannot map is never negated.
 * - A bare word searches its own text.
 */
export function filterTokenFreeTextWord(token: FilterToken): string {
  if (token.negated || token.operator === 'empty') return serializeFilterToken(token)
  if (token.operator === 'range') return token.values.map((value) => value.text).join('..')
  return token.values
    .map((value) => value.text)
    .filter((text) => text !== '')
    .join(',')
}

function anyOf(conditions: FilterCondition[]): FilterCondition {
  return conditions.length === 1 ? conditions[0] : { OR: conditions }
}

function rangeCondition(token: FilterToken, spec: FilterSpec): FilterCondition | null {
  if (token.values.length !== 2) return null
  const [low, high] = token.values
  if (low.text === '' || high.text === '') return null
  const lower = spec.toCondition('gte', low.text)
  const upper = lower === null ? null : spec.toCondition('lte', high.text)
  return lower === null || upper === null ? null : { AND: [lower, upper] }
}

function valuesCondition(
  token: FilterToken,
  operator: FilterOperator,
  spec: FilterSpec,
): FilterCondition | null {
  const conditions: FilterCondition[] = []
  for (const value of token.values) {
    if (value.text === '') continue
    const recordId = operator === 'eq' ? filterValueRecordId(value) : null
    const condition =
      recordId !== null && spec.toIdCondition
        ? spec.toIdCondition(recordId)
        : spec.toCondition(operator, value.text)
    if (condition === null) return null
    conditions.push(condition)
  }
  return conditions.length === 0 ? null : anyOf(conditions)
}

function fieldCondition(written: FilterToken, spec: FilterSpec): FilterCondition | null {
  const token = effectiveFilterToken(written, spec.operators)
  if (token.operator === 'empty') {
    if (spec.empty === undefined) return null
    return token.negated ? { NOT: spec.empty } : spec.empty
  }
  const matched =
    token.operator === 'range'
      ? rangeCondition(token, spec)
      : spec.operators.includes(token.operator)
        ? valuesCondition(token, token.operator, spec)
        : null
  if (matched === null) return null
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
 * - `field:a..b` ANDs the field's own `gte` on `a` and `lte` on `b`, on any
 *   field comparing both ways, and `-field:a..b` is `NOT` of that, composed
 *   like any other negation. On a field that takes no range it is that
 *   field's `eq` on the literal `a..b`, as it was before ranges existed
 *   ({@link effectiveFilterToken}).
 * - An unquoted `#id` value on a field whose spec has `toIdCondition` maps
 *   through it instead, matching exactly that related record, so
 *   `field:#a,#b` matches either and `-field:#id` excludes it. An id the
 *   related list cannot hold makes the token free text.
 *
 * A token that cannot map in any part (an unknown or unreadable field, an
 * unsupported operator, a value the field rejects, any one value of a list, or
 * `field:!` on a field that cannot be empty, or either bound of a range) is
 * searched as one free-text word,
 * {@link filterTokenFreeTextWord}, which is also what the Filter builder's chip
 * shows. A positive token searches its values with the field name dropped
 * (`status:draft,bogus` searches `draft,bogus`); a negated one searches its
 * whole literal (`-secret:x`) and is never negated, because `NOT` of free text
 * would turn a field the session cannot read into a filter. A free-text token
 * is read as its serialised form reads back, so a structured one with several
 * values is the words its URL holds.
 *
 * An OR group, `(a OR b)`, is the `OR` of its tokens, each mapped exactly as
 * it would be on its own and negated by the same rules. A token in a group
 * that cannot map stays in place as its free-text alternative, never dropped,
 * so it can only add rows the free-text search finds; an empty token in a
 * group is skipped, and a group of nothing but empty tokens filters nothing.
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

  const tokenCondition = (token: FilterToken): FilterCondition | null => {
    const spec = token.field === null ? undefined : specFor(token.field)
    return spec === undefined ? null : fieldCondition(token, spec)
  }

  const groupCondition = (term: FilterGroup): FilterCondition | null => {
    const alternatives = term.tokens
      .filter((token) => !isEmptyFilterToken(token))
      .map((token) => tokenCondition(token) ?? freeText(filterTokenFreeTextWord(token)))
    return alternatives.length === 0 ? null : anyOf(alternatives)
  }

  const addToken = (token: FilterToken): void => {
    // An empty value is incomplete input, not a constraint the engine failed
    // to honour: `role:` (or a bare `""`) says nothing to filter on, so it is
    // inert by design rather than narrowed away (#1509). This must be checked
    // before a token ever reaches the free-text path — an empty value there
    // would call `toCondition('eq', '')`, and a `contains`-style mapping over
    // `''` matches every row, not none. That is the opposite of #1356's
    // narrow-on-failure rule, which only ever applies to a token that DOES
    // carry a value the system cannot compile.
    if (isEmptyFilterToken(token)) return
    const condition = tokenCondition(token)
    if (condition !== null) fieldConditions.push(condition)
    else textConditions.push(freeText(filterTokenFreeTextWord(token)))
  }

  const addTerm = (term: FilterTerm): void => {
    if (term.kind === 'token') {
      addToken(term)
      return
    }
    const condition = groupCondition(term)
    if (condition !== null) fieldConditions.push(condition)
  }

  for (const term of query.terms) {
    if (term.kind === 'group') {
      parseFilterQuery(serializeFilterQuery({ terms: [term] })).terms.forEach(addTerm)
    } else if (term.field === null) {
      filterQueryTokens(parseFilterQuery(serializeFilterToken(term))).forEach(addToken)
    } else {
      addToken(term)
    }
  }

  const andConditions = [...fieldConditions, ...textConditions]
  if (andConditions.length === 0) return undefined
  if (andConditions.length === 1) return andConditions[0]
  return { AND: andConditions }
}
