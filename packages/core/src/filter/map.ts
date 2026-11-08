import { FILTER_OPERATOR_PREFIXES } from './parse.js'
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

function literalWord(token: FilterToken): string {
  const negation = token.negated ? '-' : ''
  const field = token.field === null ? '' : `${token.field}:`
  if (token.operator === 'empty') return `${negation}${field}!`
  const values = token.values.map((value) => value.text).join(',')
  return `${negation}${field}${FILTER_OPERATOR_PREFIXES[token.operator]}${values}`
}

function anyOf(conditions: FilterCondition[]): FilterCondition {
  return conditions.length === 1 ? conditions[0] : { OR: conditions }
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
 * - `field:!` is the field's `empty` condition and `-field:!` its `NOT`.
 *
 * A token degrades to free text (never an error) when its field is unknown,
 * has no spec, uses an unsupported operator, or cannot be empty for `field:!`.
 * A value its field maps to `null` degrades on its own, as a free-text
 * alternative to the token's other values. A token that cannot map is never
 * negated: a negated one is searched as the literal word it was written as
 * (`-secret:x`), because `NOT` of free text would turn a field the session
 * cannot read into a filter.
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
  const capabilitiesFor = (field: string): FilterFieldCapabilities | undefined => {
    const spec = specFor(field)
    return spec && { operators: spec.operators, canBeEmpty: spec.empty !== undefined }
  }

  const freeText = (word: string): FilterCondition => {
    const conditions = freeTextFields
      .map((field) => specs[field].toCondition('eq', word))
      .filter((condition): condition is FilterCondition => condition !== null)
    return conditions.length > 0 ? anyOf(conditions) : NEVER_MATCHES
  }

  for (const token of query.terms) {
    // An empty value is incomplete input, not a constraint the engine failed
    // to honour: `role:` (or a bare `""`) says nothing to filter on, so it is
    // inert by design rather than narrowed away (#1509). This must be checked
    // before a token ever reaches the free-text path — an empty value there
    // would call `toCondition('eq', '')`, and a `contains`-style mapping over
    // `''` matches every row, not none. That is the opposite of #1356's
    // narrow-on-failure rule, which only ever applies to a token that DOES
    // carry a value the system cannot compile.
    if (isEmptyFilterToken(token)) continue

    const texts = token.values.map((value) => value.text).filter((text) => text !== '')
    const spec = isFieldConditionToken(token, capabilitiesFor) ? specFor(token.field) : undefined

    if (!spec) {
      if (token.negated || token.operator === 'empty') {
        textConditions.push(freeText(literalWord(token)))
      } else {
        textConditions.push(anyOf(texts.map(freeText)))
      }
      continue
    }

    if (token.operator === 'empty') {
      const empty = spec.empty
      if (empty === undefined) textConditions.push(freeText(literalWord(token)))
      else fieldConditions.push(token.negated ? { NOT: empty } : empty)
      continue
    }

    const operator = token.operator
    const mapped = texts.map((text) => spec.toCondition(operator, text))

    if (!token.negated) {
      const alternatives = mapped.map((condition, index) => condition ?? freeText(texts[index]))
      const target = mapped.every((condition) => condition !== null)
        ? fieldConditions
        : textConditions
      target.push(anyOf(alternatives))
      continue
    }

    const conditions = mapped.filter(
      (condition): condition is FilterCondition => condition !== null,
    )
    if (conditions.length !== mapped.length) {
      textConditions.push(freeText(literalWord(token)))
      continue
    }
    const excluded: FilterCondition = { NOT: anyOf(conditions) }
    fieldConditions.push(spec.empty === undefined ? excluded : { OR: [excluded, spec.empty] })
  }

  const andConditions = [...fieldConditions, ...textConditions]
  if (andConditions.length === 0) return undefined
  if (andConditions.length === 1) return andConditions[0]
  return { AND: andConditions }
}
