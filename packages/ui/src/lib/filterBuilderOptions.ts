import {
  FILTER_COMPARISON_PREFIXES,
  filterTokenFreeTextWord,
  isEmptyFilterToken,
  isFieldConditionToken,
  parseFilterQuery,
  serializeFilterQuery,
  type FilterFieldSuggestion,
  type FilterOperator,
  type FilterToken,
} from '@opensaas/stack-core'
import { formatFieldName } from './utils.js'

export type FilterFields = ReadonlyMap<string, FilterFieldSuggestion>

/**
 * A condition the Filter builder offers for a field: one of the field's own
 * operators, or one the engine composes around them.
 */
export type FilterBuilderCondition = FilterOperator | 'not' | 'anyOf' | 'empty' | 'notEmpty'

export interface FilterDraft {
  field: string
  condition: FilterBuilderCondition
}

export type FilterOption =
  | { kind: 'field'; field: string; group: string }
  | { kind: 'apply'; tokens: FilterToken[]; label: string; group: string; selected?: boolean }
  | { kind: 'toggle'; tokens: FilterToken[]; label: string; group: string; selected: boolean }

export interface FilterOptions {
  options: FilterOption[]
  hint: string | null
}

export interface TokenDescription {
  field: string
  condition: string
  value: string
  sentence: string
}

const COMPARISON_LABELS: Record<Exclude<FilterOperator, 'eq'>, string> = {
  gt: 'greater than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
}

interface PhraseCondition {
  operator: FilterOperator
  negated: boolean
}

const PHRASE_CONDITIONS: Record<string, PhraseCondition> = {
  ...Object.fromEntries(
    FILTER_COMPARISON_PREFIXES.map(([prefix, operator]) => [prefix, { operator, negated: false }]),
  ),
  '=': { operator: 'eq', negated: false },
  '!=': { operator: 'eq', negated: true },
  is: { operator: 'eq', negated: false },
  contains: { operator: 'eq', negated: false },
  'is not': { operator: 'eq', negated: true },
  'does not contain': { operator: 'eq', negated: true },
  after: { operator: 'gt', negated: false },
  before: { operator: 'lt', negated: false },
}

const SYMBOL_PHRASE = /^(.+?)\s*(>=|<=|!=|>|<|=)\s*(.+)$/
const WORD_PHRASE = /^(.+?)\s+(is not|does not contain|is|contains|after|before)\s+(.+)$/i
const EMPTY_PHRASE = /^(.+?)\s+is\s+(not\s+)?empty$/i
const FIELD_TOKEN_SHAPE = /[A-Za-z_][A-Za-z0-9_]*:\S/
const VALUE_FIRST_MIN_LENGTH = 2

export function fieldToken(
  field: string,
  operator: FilterOperator,
  value: string,
  negated = false,
): FilterToken {
  return { kind: 'token', field, operator, negated, values: [{ text: value, quoted: false }] }
}

function anyOfToken(field: string, values: readonly string[]): FilterToken {
  return {
    kind: 'token',
    field,
    operator: 'eq',
    negated: false,
    values: values.map((text) => ({ text, quoted: false })),
  }
}

function emptyToken(field: string, negated: boolean): FilterToken {
  return { kind: 'token', field, operator: 'empty', negated, values: [] }
}

export function textToken(value: string): FilterToken {
  return {
    kind: 'token',
    field: null,
    operator: 'eq',
    negated: false,
    values: [{ text: value, quoted: false }],
  }
}

export function filterQuery(tokens: readonly FilterToken[]): string {
  return serializeFilterQuery({ terms: tokens.filter((token) => !isEmptyFilterToken(token)) })
}

export function hydrateTokens(query: string): FilterToken[] {
  return parseFilterQuery(query).terms.filter((token) => !isEmptyFilterToken(token))
}

export function freeTextTokens(text: string): FilterToken[] {
  return hydrateTokens(text).map((token) =>
    token.field === null ? token : textToken(serializeFilterQuery({ terms: [token] })),
  )
}

export function editableText(token: FilterToken): string {
  return serializeFilterQuery({ terms: [token] })
}

function valueTexts(token: FilterToken): string[] {
  return token.values.map((value) => value.text).filter((text) => text !== '')
}

function eqMatchesPart(suggestion: FilterFieldSuggestion): boolean {
  return suggestion.freeText || suggestion.valueSource.kind === 'relationship'
}

/**
 * The conditions the Filter builder offers for a field, in Tab order. They
 * derive from the field's Filter spec alone: its own operators, "is not"
 * (unless the spec says negation is redundant) and, for an enumerated field,
 * "is any of" around equality, and "is empty" / "is not empty" where the
 * field can be empty.
 */
export function conditionsOf(suggestion: FilterFieldSuggestion): FilterBuilderCondition[] {
  const conditions: FilterBuilderCondition[] = [...suggestion.operators]
  if (suggestion.operators.includes('eq')) {
    if (suggestion.negation !== 'redundant') conditions.push('not')
    if (suggestion.valueSource.kind === 'enum') conditions.push('anyOf')
  }
  if (suggestion.canBeEmpty === true) conditions.push('empty', 'notEmpty')
  return conditions
}

function shapeLabel(
  suggestion: FilterFieldSuggestion,
  operator: FilterOperator,
  negated: boolean,
  many: boolean,
): string {
  if (operator !== 'eq') {
    return `${negated ? 'not ' : ''}${COMPARISON_LABELS[operator]}${many ? ' any of' : ''}`
  }
  const part = eqMatchesPart(suggestion)
  if (!negated) return `${part ? 'contains' : 'is'}${many ? ' any of' : ''}`
  if (many) return part ? 'contains none of' : 'is none of'
  return part ? 'does not contain' : 'is not'
}

export function conditionLabel(
  suggestion: FilterFieldSuggestion,
  condition: FilterBuilderCondition,
): string {
  if (condition === 'empty') return 'is empty'
  if (condition === 'notEmpty') return 'is not empty'
  if (condition === 'not') return shapeLabel(suggestion, 'eq', true, false)
  if (condition === 'anyOf') return shapeLabel(suggestion, 'eq', false, true)
  return shapeLabel(suggestion, condition, false, false)
}

/**
 * The builder condition a field-condition token is edited under, or `null`
 * when the builder has no single condition for its shape (such as "is none of").
 */
export function conditionOfToken(token: FilterToken): FilterBuilderCondition | null {
  if (token.operator === 'empty') return token.negated ? 'notEmpty' : 'empty'
  const many = valueTexts(token).length > 1
  if (token.operator === 'eq') {
    if (token.negated) return many ? null : 'not'
    return many ? 'anyOf' : 'eq'
  }
  return token.negated || many ? null : token.operator
}

export function fieldLabel(field: string): string {
  return formatFieldName(field)
}

function optionLabel(suggestion: FilterFieldSuggestion, value: string): string {
  if (suggestion.valueSource.kind !== 'enum') return value
  const needle = value.toLowerCase()
  return (
    suggestion.valueSource.options.find((option) => option.value.toLowerCase() === needle)?.label ??
    value
  )
}

export function isFieldCondition(
  token: FilterToken,
  fields: FilterFields,
): token is FilterToken & { field: string } {
  if (!isFieldConditionToken(token, (field) => fields.get(field))) return false
  const suggestion = fields.get(token.field)
  if (suggestion === undefined) return false
  const operator = token.operator
  if (operator === 'empty') return true
  return valueTexts(token).every((text) => checkValue(suggestion, operator, text).ok)
}

export function describeToken(token: FilterToken, fields: FilterFields): TokenDescription {
  const suggestion = token.field === null ? undefined : fields.get(token.field)
  if (suggestion && isFieldCondition(token, fields)) {
    const field = fieldLabel(suggestion.field)
    const texts = valueTexts(token)
    const condition =
      token.operator === 'empty'
        ? conditionLabel(suggestion, token.negated ? 'notEmpty' : 'empty')
        : shapeLabel(suggestion, token.operator, token.negated, texts.length > 1)
    const value = texts.map((text) => optionLabel(suggestion, text)).join(', ')
    const sentence = value ? `${field} ${condition} ${value}` : `${field} ${condition}`
    return { field, condition, value, sentence }
  }
  const value = filterTokenFreeTextWord(token)
  return { field: 'Text', condition: 'contains', value, sentence: `Text contains ${value}` }
}

function isSingleChoice(token: FilterToken, fields: FilterFields): boolean {
  if (
    token.field === null ||
    token.negated ||
    token.operator !== 'eq' ||
    !isFieldCondition(token, fields)
  ) {
    return false
  }
  const suggestion = fields.get(token.field)
  return suggestion !== undefined && !eqMatchesPart(suggestion)
}

export function lastChoicePerField(
  tokens: readonly FilterToken[],
  fields: FilterFields,
): FilterToken[] {
  return tokens.filter(
    (token, index) =>
      !isSingleChoice(token, fields) ||
      !tokens
        .slice(index + 1)
        .some((later) => later.field === token.field && isSingleChoice(later, fields)),
  )
}

export function placeTokens(
  tokens: readonly FilterToken[],
  added: readonly FilterToken[],
  at: number | null,
  fields: FilterFields,
  replace: boolean,
): FilterToken[] {
  const placed = replace ? lastChoicePerField(added, fields) : [...added]
  const next = [...tokens]
  if (at !== null && at < next.length) next.splice(at, 1, ...placed)
  else next.push(...placed)
  if (!replace) return next
  const chosen = new Set(
    placed.filter((token) => isSingleChoice(token, fields)).map((token) => token.field),
  )
  return next.filter(
    (other) =>
      placed.includes(other) ||
      other.field === null ||
      !chosen.has(other.field) ||
      !isSingleChoice(other, fields),
  )
}

type ValueCheck = { ok: true; value: string } | { ok: false; message: string }

function matchesFormat(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value)
  } catch {
    return true
  }
}

export function checkValue(
  suggestion: FilterFieldSuggestion,
  operator: FilterOperator,
  raw: string,
): ValueCheck {
  const value = raw.trim()
  const label = fieldLabel(suggestion.field)
  if (value === '') return { ok: false, message: `Type a value for ${label}.` }
  if (suggestion.valueSource.kind === 'enum') {
    const needle = value.toLowerCase()
    const match = suggestion.valueSource.options.find(
      (option) => option.value.toLowerCase() === needle || option.label.toLowerCase() === needle,
    )
    return match
      ? { ok: true, value: match.value }
      : { ok: false, message: `No ${label.toLowerCase()} matches “${value}”.` }
  }
  const format = suggestion.valueFormat?.operators?.[operator] ?? suggestion.valueFormat
  if (format && !matchesFormat(format.pattern, value)) {
    return { ok: false, message: `${label} ${format.description}.` }
  }
  return { ok: true, value }
}

export function splitComparison(
  suggestion: FilterFieldSuggestion,
  text: string,
): { operator: FilterOperator; rest: string } | null {
  const trimmed = text.trimStart()
  for (const [prefix, operator] of FILTER_COMPARISON_PREFIXES) {
    if (trimmed.startsWith(prefix) && suggestion.operators.includes(operator)) {
      return { operator, rest: trimmed.slice(prefix.length).trimStart() }
    }
  }
  return null
}

export function findField(fields: FilterFields, name: string): FilterFieldSuggestion | undefined {
  const needle = name.trim().toLowerCase()
  for (const suggestion of fields.values()) {
    if (
      suggestion.field.toLowerCase() === needle ||
      fieldLabel(suggestion.field).toLowerCase() === needle
    ) {
      return suggestion
    }
  }
  return undefined
}

type PhraseResult = { kind: 'token'; token: FilterToken } | { kind: 'invalid'; message: string }

function emptyPhrase(text: string, fields: FilterFields): PhraseResult | null {
  const match = EMPTY_PHRASE.exec(text.trim())
  const suggestion = match ? findField(fields, match[1]) : undefined
  if (!match || !suggestion?.canBeEmpty) return null
  return { kind: 'token', token: emptyToken(suggestion.field, match[2] !== undefined) }
}

export function parsePhrase(text: string, fields: FilterFields): PhraseResult | null {
  const empty = emptyPhrase(text, fields)
  if (empty) return empty
  let match: RegExpExecArray | null = null
  let suggestion: FilterFieldSuggestion | undefined
  for (const shape of [SYMBOL_PHRASE, WORD_PHRASE]) {
    const candidate = shape.exec(text.trim())
    const found = candidate ? findField(fields, candidate[1]) : undefined
    if (candidate && found) {
      match = candidate
      suggestion = found
      break
    }
  }
  if (!match || !suggestion) return null
  const phrase = Object.hasOwn(PHRASE_CONDITIONS, match[2].toLowerCase())
    ? PHRASE_CONDITIONS[match[2].toLowerCase()]
    : undefined
  if (phrase === undefined) return null
  const label = fieldLabel(suggestion.field)
  if (!suggestion.operators.includes(phrase.operator)) {
    return { kind: 'invalid', message: `${label} cannot be compared with “${match[2]}”.` }
  }
  const check = checkValue(suggestion, phrase.operator, match[3])
  if (!check.ok) return { kind: 'invalid', message: check.message }
  return {
    kind: 'token',
    token: fieldToken(suggestion.field, phrase.operator, check.value, phrase.negated),
  }
}

function fieldValuePrefix(
  fields: FilterFields,
  text: string,
): { suggestion: FilterFieldSuggestion; rest: string } | null {
  const lower = text.toLowerCase()
  for (const suggestion of fields.values()) {
    for (const name of [fieldLabel(suggestion.field), suggestion.field]) {
      const prefix = `${name.toLowerCase()} `
      if (lower.startsWith(prefix)) {
        const rest = text.slice(prefix.length).trim()
        if (rest) return { suggestion, rest }
      }
    }
  }
  return null
}

function sentenceOf(tokens: readonly FilterToken[], fields: FilterFields): string {
  return tokens.map((token) => describeToken(token, fields).sentence).join(' and ')
}

function searchOption(text: string): FilterOption {
  return {
    kind: 'apply',
    tokens: freeTextTokens(text),
    label: `Search all text for “${text.trim()}”`,
    group: 'Search',
  }
}

function enumMatches(suggestion: FilterFieldSuggestion, needle: string) {
  if (suggestion.valueSource.kind !== 'enum') return []
  const lower = needle.toLowerCase()
  return suggestion.valueSource.options.filter(
    (option) =>
      option.label.toLowerCase().includes(lower) || option.value.toLowerCase().includes(lower),
  )
}

export function rootOptions(text: string, fields: FilterFields): FilterOptions {
  const typed = text.trim()
  if (typed === '') {
    return {
      options: [...fields.keys()].map((field) => ({ kind: 'field', field, group: 'Filter by' })),
      hint: null,
    }
  }

  const options: FilterOption[] = []
  const seen = new Set<string>()
  let hint: string | null = null
  const offer = (tokens: FilterToken[], group: string) => {
    const key = filterQuery(tokens)
    if (key === '' || seen.has(key)) return
    seen.add(key)
    options.push({ kind: 'apply', tokens, label: sentenceOf(tokens, fields), group })
  }

  if (FIELD_TOKEN_SHAPE.test(typed)) {
    const terms = hydrateTokens(typed)
    if (terms.some((token) => isFieldCondition(token, fields))) {
      offer(lastChoicePerField(terms, fields), 'Suggestions')
    }
  }

  const phrase = parsePhrase(typed, fields)
  if (phrase?.kind === 'token') offer([phrase.token], 'Suggestions')
  else if (phrase?.kind === 'invalid') hint = phrase.message

  const prefixed = fieldValuePrefix(fields, typed)
  if (prefixed && phrase === null) {
    const { suggestion, rest } = prefixed
    if (suggestion.valueSource.kind === 'enum') {
      for (const option of enumMatches(suggestion, rest)) {
        offer([fieldToken(suggestion.field, 'eq', option.value)], 'Suggestions')
      }
    } else {
      const comparison = splitComparison(suggestion, rest)
      const check = checkValue(suggestion, comparison?.operator ?? 'eq', comparison?.rest ?? rest)
      if (check.ok) {
        offer(
          [fieldToken(suggestion.field, comparison?.operator ?? 'eq', check.value)],
          'Suggestions',
        )
      } else {
        hint = check.message
      }
    }
  }

  const lower = typed.toLowerCase()
  const fieldMatches = [...fields.keys()]
    .map((field) => ({ field, at: fieldLabel(field).toLowerCase().indexOf(lower) }))
    .filter(({ field, at }) => at >= 0 || field.toLowerCase().includes(lower))
    .sort((a, b) => (a.at < 0 ? Infinity : a.at) - (b.at < 0 ? Infinity : b.at))
  for (const { field } of fieldMatches) options.push({ kind: 'field', field, group: 'Fields' })

  if (typed.length >= VALUE_FIRST_MIN_LENGTH) {
    for (const suggestion of fields.values()) {
      for (const option of enumMatches(suggestion, typed)) {
        offer([fieldToken(suggestion.field, 'eq', option.value)], 'Values')
      }
    }
  }

  options.push(searchOption(typed))
  return { options, hint }
}

function anyOfOptions(
  suggestion: FilterFieldSuggestion,
  typed: string,
  current: FilterToken | undefined,
): FilterOption[] {
  const chosen =
    current && current.field === suggestion.field && current.operator === 'eq' && !current.negated
      ? valueTexts(current)
      : []
  const isChosen = (value: string) =>
    chosen.some((text) => text.toLowerCase() === value.toLowerCase())
  return enumMatches(suggestion, typed).map((option) => {
    const selected = isChosen(option.value)
    const next = selected
      ? chosen.filter((text) => text.toLowerCase() !== option.value.toLowerCase())
      : [...chosen, option.value]
    return {
      kind: 'toggle',
      tokens: next.length > 0 ? [anyOfToken(suggestion.field, next)] : [],
      label: option.label,
      group: `${fieldLabel(suggestion.field)} is any of`,
      selected,
    }
  })
}

export function draftOptions(
  draft: FilterDraft,
  text: string,
  fields: FilterFields,
  current: FilterToken | undefined,
): FilterOptions {
  const suggestion = fields.get(draft.field)
  if (!suggestion) return { options: [], hint: null }
  const typed = text.trim()
  const options: FilterOption[] = []
  let hint: string | null = null
  const { condition } = draft

  if (condition === 'empty' || condition === 'notEmpty') {
    const token = emptyToken(suggestion.field, condition === 'notEmpty')
    options.push({
      kind: 'apply',
      tokens: [token],
      label: describeToken(token, fields).sentence,
      group: fieldLabel(suggestion.field),
    })
  } else if (condition === 'anyOf') {
    options.push(...anyOfOptions(suggestion, typed, current))
    if (options.length === 0 && typed !== '') {
      hint = `No ${fieldLabel(suggestion.field).toLowerCase()} matches “${typed}”.`
    }
  } else {
    const negated = condition === 'not'
    const operator: FilterOperator = condition === 'not' ? 'eq' : condition
    if (suggestion.valueSource.kind === 'enum') {
      const currentValue =
        current && current.field === draft.field && conditionOfToken(current) === condition
          ? current.values[0]?.text.toLowerCase()
          : undefined
      for (const option of enumMatches(suggestion, typed)) {
        options.push({
          kind: 'apply',
          tokens: [fieldToken(suggestion.field, operator, option.value, negated)],
          label: option.label,
          group: fieldLabel(suggestion.field),
          selected: option.value.toLowerCase() === currentValue,
        })
      }
      if (options.length === 0 && typed !== '') {
        hint = `No ${fieldLabel(suggestion.field).toLowerCase()} matches “${typed}”.`
      }
    } else {
      const comparison = negated ? splitComparison(suggestion, typed) : null
      const typedOperator = comparison?.operator ?? operator
      const check = checkValue(suggestion, typedOperator, comparison?.rest ?? typed)
      if (check.ok) {
        const token = fieldToken(suggestion.field, typedOperator, check.value, negated)
        options.push({
          kind: 'apply',
          tokens: [token],
          label: describeToken(token, fields).sentence,
          group: fieldLabel(suggestion.field),
        })
      } else {
        hint = check.message
      }
    }
  }

  if (typed !== '') options.push(searchOption(typed))
  return { options, hint }
}
