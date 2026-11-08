import {
  filterTokenOperators,
  isEmptyFilterToken,
  isFieldConditionToken,
  parseFilterQuery,
  serializeFilterQuery,
  type FilterFieldSuggestion,
  type FilterOperator,
  type FilterToken,
  type FilterTokenOperator,
} from '@opensaas/stack-core'
import { formatFieldName } from './utils.js'

export type FilterFields = ReadonlyMap<string, FilterFieldSuggestion>

export interface FilterDraft {
  field: string
  operator: FilterTokenOperator
}

export interface FilterRange {
  low: string
  high: string
}

export interface FilterChip {
  start: number
  count: number
  description: TokenDescription
  range: FilterRange | null
}

export interface DatePreset {
  label: string
  from: string
  to: string
}

export type FilterOption =
  | { kind: 'field'; field: string; group: string }
  | { kind: 'apply'; tokens: FilterToken[]; label: string; group: string; selected?: boolean }

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

const COMPARISON_LABELS: Record<Exclude<FilterTokenOperator, 'eq'>, string> = {
  gt: 'greater than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
  range: 'between',
}

const COMPARISON_PREFIXES: ReadonlyArray<readonly [string, FilterOperator]> = [
  ['>=', 'gte'],
  ['<=', 'lte'],
  ['>', 'gt'],
  ['<', 'lt'],
]

const PHRASE_OPERATORS: Record<string, FilterOperator> = {
  '>=': 'gte',
  '<=': 'lte',
  '>': 'gt',
  '<': 'lt',
  '=': 'eq',
  is: 'eq',
  contains: 'eq',
  after: 'gt',
  before: 'lt',
}

const SYMBOL_PHRASE = /^(.+?)\s*(>=|<=|>|<|=)\s*(.+)$/
const WORD_PHRASE = /^(.+?)\s+(is|contains|after|before)\s+(.+)$/i
const BETWEEN_PHRASE = /^(.+?)\s+between\s+(.+)$/i
const RANGE_WORDS = /\s+(?:to|and)\s+/i
const RANGE_DASHES = /[-\u2013]/g
const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const FIELD_TOKEN_SHAPE = /[A-Za-z_][A-Za-z0-9_]*:\S/
const VALUE_FIRST_MIN_LENGTH = 2

export function fieldToken(field: string, operator: FilterOperator, value: string): FilterToken {
  return { kind: 'token', field, operator, negated: false, values: [value], quoted: false }
}

export function rangeToken(field: string, low: string, high: string): FilterToken {
  return {
    kind: 'token',
    field,
    operator: 'range',
    negated: false,
    values: [low, high],
    quoted: false,
  }
}

export function textToken(value: string): FilterToken {
  return {
    kind: 'token',
    field: null,
    operator: 'eq',
    negated: false,
    values: [value],
    quoted: false,
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

export function operatorsOf(fields: FilterFields) {
  return (field: string) => fields.get(field)?.operators
}

export function conditionsOf(suggestion: FilterFieldSuggestion): FilterTokenOperator[] {
  return filterTokenOperators(suggestion.operators)
}

const pad = (value: number, width = 2) => String(Math.abs(value)).padStart(width, '0')

export function formatOffset(minutesBehindUtc: number): string {
  const ahead = -minutesBehindUtc
  const sign = ahead < 0 ? '-' : '+'
  return `${sign}${pad(Math.trunc(Math.abs(ahead) / 60))}:${pad(Math.abs(ahead) % 60)}`
}

export function localDay(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function localInstant(date: Date): string {
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  const millis = pad(date.getMilliseconds(), 3)
  return `${localDay(date)}T${time}.${millis}${formatOffset(date.getTimezoneOffset())}`
}

function plainDate(value: string): Date | null {
  const match = PLAIN_DATE.exec(value.trim())
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return localDay(date) === value.trim() ? date : null
}

export function dayBoundary(day: string, end: boolean): string | null {
  const date = plainDate(day)
  if (!date) return null
  if (end) date.setHours(23, 59, 59, 999)
  return localInstant(date)
}

function boundOf(suggestion: FilterFieldSuggestion, value: string, end: boolean): string {
  if (suggestion.datePicker !== 'instant') return value
  return dayBoundary(value, end) ?? value
}

function displayBound(suggestion: FilterFieldSuggestion, value: string, end: boolean): string {
  if (suggestion.datePicker !== 'instant' || PLAIN_DATE.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const day = localDay(date)
  return dayBoundary(day, end) === localInstant(date) ? day : value
}

const endsTheDay = (operator: FilterOperator) => operator === 'gt' || operator === 'lte'

export function conditionTokens(
  suggestion: FilterFieldSuggestion,
  operator: FilterOperator,
  value: string,
): FilterToken[] {
  if (operator === 'eq' && suggestion.datePicker === 'instant') {
    const from = dayBoundary(value, false)
    const to = dayBoundary(value, true)
    if (from && to) return [rangeToken(suggestion.field, from, to)]
  }
  return [fieldToken(suggestion.field, operator, boundOf(suggestion, value, endsTheDay(operator)))]
}

export function rangeTokens(
  suggestion: FilterFieldSuggestion,
  low: string,
  high: string,
): FilterToken[] {
  return [
    rangeToken(suggestion.field, boundOf(suggestion, low, false), boundOf(suggestion, high, true)),
  ]
}

function shiftDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

export function datePresets(today: Date): DatePreset[] {
  const year = today.getFullYear()
  const month = today.getMonth()
  const day = localDay(today)
  return [
    { label: 'Today', from: day, to: day },
    { label: 'Last 7 days', from: localDay(shiftDays(today, -6)), to: day },
    { label: 'Last 30 days', from: localDay(shiftDays(today, -29)), to: day },
    {
      label: 'This month',
      from: localDay(new Date(year, month, 1)),
      to: localDay(new Date(year, month + 1, 0)),
    },
    {
      label: 'Last month',
      from: localDay(new Date(year, month - 1, 1)),
      to: localDay(new Date(year, month, 0)),
    },
    {
      label: 'This year',
      from: localDay(new Date(year, 0, 1)),
      to: localDay(new Date(year, 11, 31)),
    },
  ]
}

function eqMatchesPart(suggestion: FilterFieldSuggestion): boolean {
  return suggestion.freeText || suggestion.valueSource.kind === 'relationship'
}

export function conditionLabel(
  suggestion: FilterFieldSuggestion,
  operator: FilterTokenOperator,
): string {
  if (operator !== 'eq') return COMPARISON_LABELS[operator]
  return eqMatchesPart(suggestion) ? 'contains' : 'is'
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
  if (!isFieldConditionToken(token, operatorsOf(fields))) return false
  const suggestion = fields.get(token.field)
  if (suggestion === undefined) return false
  if (token.operator === 'range') {
    const [low, high] = token.values
    return checkValue(suggestion, 'gte', low).ok && checkValue(suggestion, 'lte', high).ok
  }
  return token.values.length === 1 && checkValue(suggestion, token.operator, token.values[0]).ok
}

function describeRange(suggestion: FilterFieldSuggestion, range: FilterRange): TokenDescription {
  const field = fieldLabel(suggestion.field)
  const low = displayBound(suggestion, range.low, false)
  const high = displayBound(suggestion, range.high, true)
  return {
    field,
    condition: 'between',
    value: `${low} – ${high}`,
    sentence: `${field} between ${low} and ${high}`,
  }
}

export function describeToken(token: FilterToken, fields: FilterFields): TokenDescription {
  const suggestion = token.field === null ? undefined : fields.get(token.field)
  if (suggestion && isFieldCondition(token, fields)) {
    if (token.operator === 'range') {
      return describeRange(suggestion, { low: token.values[0], high: token.values[1] })
    }
    const field = fieldLabel(suggestion.field)
    const condition = conditionLabel(suggestion, token.operator)
    const value =
      suggestion.valueSource.kind === 'enum'
        ? optionLabel(suggestion, token.values[0])
        : displayBound(suggestion, token.values[0], endsTheDay(token.operator))
    return { field, condition, value, sentence: `${field} ${condition} ${value}` }
  }
  const value =
    token.field === null && !token.negated && token.values.length === 1
      ? token.values[0]
      : serializeFilterQuery({ terms: [token] })
  return { field: 'Text', condition: 'contains', value, sentence: `Text contains ${value}` }
}

function pairedRange(
  first: FilterToken | undefined,
  second: FilterToken | undefined,
  fields: FilterFields,
): FilterRange | null {
  if (!first || !second || first.field === null || first.field !== second.field) return null
  if (!isFieldCondition(first, fields) || !isFieldCondition(second, fields)) return null
  if (first.operator === 'gte' && second.operator === 'lte') {
    return { low: first.values[0], high: second.values[0] }
  }
  if (first.operator === 'lte' && second.operator === 'gte') {
    return { low: second.values[0], high: first.values[0] }
  }
  return null
}

export function chipsOf(tokens: readonly FilterToken[], fields: FilterFields): FilterChip[] {
  const chips: FilterChip[] = []
  for (let start = 0; start < tokens.length; start++) {
    const token = tokens[start]
    const suggestion = token.field === null ? undefined : fields.get(token.field)
    const paired = suggestion ? pairedRange(token, tokens[start + 1], fields) : null
    if (suggestion && paired) {
      chips.push({ start, count: 2, description: describeRange(suggestion, paired), range: paired })
      start++
      continue
    }
    const range =
      token.operator === 'range' && isFieldCondition(token, fields)
        ? { low: token.values[0], high: token.values[1] }
        : null
    chips.push({ start, count: 1, description: describeToken(token, fields), range })
  }
  return chips
}

export function chipEditText(
  chip: FilterChip,
  token: FilterToken,
  fields: FilterFields,
): { draft: FilterDraft | null; text: string } {
  const suggestion = token.field === null ? undefined : fields.get(token.field)
  if (!suggestion || !isFieldCondition(token, fields)) {
    return { draft: null, text: editableText(token) }
  }
  if (chip.range) {
    const low = displayBound(suggestion, chip.range.low, false)
    const high = displayBound(suggestion, chip.range.high, true)
    return { draft: { field: suggestion.field, operator: 'range' }, text: `${low}..${high}` }
  }
  const draft = { field: suggestion.field, operator: token.operator }
  if (suggestion.valueSource.kind === 'enum') return { draft, text: '' }
  return { draft, text: chip.description.value }
}

function isSingleChoice(token: FilterToken, fields: FilterFields): boolean {
  if (token.field === null || token.operator !== 'eq' || !isFieldCondition(token, fields)) {
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
  at: { start: number; count: number } | null,
  fields: FilterFields,
  replace: boolean,
): FilterToken[] {
  const placed = replace ? lastChoicePerField(added, fields) : [...added]
  const next = [...tokens]
  if (at !== null && at.start < next.length) next.splice(at.start, at.count, ...placed)
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

type RangeCheck = { ok: true; low: string; high: string } | { ok: false; message: string }

function rangeSplits(text: string): Array<[string, string]> {
  const dots = text.indexOf('..')
  if (dots >= 0) return [[text.slice(0, dots), text.slice(dots + 2)]]
  const words = RANGE_WORDS.exec(text)
  if (words) return [[text.slice(0, words.index), text.slice(words.index + words[0].length)]]
  return [...text.matchAll(RANGE_DASHES)]
    .map((match) => match.index)
    .filter((at) => at > 0 && at < text.length - 1)
    .map((at) => [text.slice(0, at), text.slice(at + 1)])
}

const bothDates = ([low, high]: [string, string]) =>
  plainDate(low) !== null && plainDate(high) !== null

const bothParse = ([low, high]: [string, string]) =>
  !Number.isNaN(new Date(low).getTime()) && !Number.isNaN(new Date(high).getTime())

export function checkRange(suggestion: FilterFieldSuggestion, raw: string): RangeCheck {
  const label = fieldLabel(suggestion.field)
  const typed = raw.trim()
  const shape = `Type a range for ${label}, as from..to.`
  if (typed === '') return { ok: false, message: shape }
  let firstMiss: string | null = null
  let fits: Array<[string, string]> = []
  for (const [rawLow, rawHigh] of rangeSplits(typed)) {
    const low = checkValue(suggestion, 'gte', rawLow)
    const high = checkValue(suggestion, 'lte', rawHigh)
    if (low.ok && high.ok) fits.push([low.value, high.value])
    else firstMiss ??= !low.ok ? low.message : !high.ok ? high.message : null
  }
  if (fits.length > 1 && suggestion.datePicker) {
    const dated = fits.filter(bothDates)
    fits = dated.length > 0 ? dated : fits.filter(bothParse)
  }
  if (fits.length === 1) return { ok: true, low: fits[0][0], high: fits[0][1] }
  return { ok: false, message: fits.length > 1 ? shape : (firstMiss ?? shape) }
}

export function splitComparison(
  suggestion: FilterFieldSuggestion,
  text: string,
): { operator: FilterOperator; rest: string } | null {
  const trimmed = text.trimStart()
  for (const [prefix, operator] of COMPARISON_PREFIXES) {
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

type PhraseResult = { kind: 'token'; tokens: FilterToken[] } | { kind: 'invalid'; message: string }

function parseBetween(text: string, fields: FilterFields): PhraseResult | null {
  const match = BETWEEN_PHRASE.exec(text.trim())
  const suggestion = match ? findField(fields, match[1]) : undefined
  if (!match || !suggestion) return null
  if (!conditionsOf(suggestion).includes('range')) {
    return { kind: 'invalid', message: `${fieldLabel(suggestion.field)} has no range.` }
  }
  const check = checkRange(suggestion, match[2])
  if (!check.ok) return { kind: 'invalid', message: check.message }
  return { kind: 'token', tokens: rangeTokens(suggestion, check.low, check.high) }
}

export function parsePhrase(text: string, fields: FilterFields): PhraseResult | null {
  const between = parseBetween(text, fields)
  if (between) return between
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
  const operator = PHRASE_OPERATORS[match[2].toLowerCase()]
  if (operator === undefined) return null
  const label = fieldLabel(suggestion.field)
  if (!suggestion.operators.includes(operator)) {
    return { kind: 'invalid', message: `${label} cannot be compared with “${match[2]}”.` }
  }
  const check = checkValue(suggestion, operator, match[3])
  if (!check.ok) return { kind: 'invalid', message: check.message }
  return { kind: 'token', tokens: conditionTokens(suggestion, operator, check.value) }
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
  if (phrase?.kind === 'token') offer(phrase.tokens, 'Suggestions')
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
      const operator = comparison?.operator ?? 'eq'
      const check = checkValue(suggestion, operator, comparison?.rest ?? rest)
      const range =
        !check.ok && !comparison && conditionsOf(suggestion).includes('range')
          ? checkRange(suggestion, rest)
          : null
      if (check.ok) {
        offer(conditionTokens(suggestion, operator, check.value), 'Suggestions')
      } else if (range?.ok) {
        offer(rangeTokens(suggestion, range.low, range.high), 'Suggestions')
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

type TokensCheck = { ok: true; tokens: FilterToken[] } | { ok: false; message: string }

export function draftTokens(
  suggestion: FilterFieldSuggestion,
  operator: FilterTokenOperator,
  typed: string,
): TokensCheck {
  if (operator === 'range') {
    const range = checkRange(suggestion, typed)
    if (!range.ok) return range
    return { ok: true, tokens: rangeTokens(suggestion, range.low, range.high) }
  }
  const single = checkValue(suggestion, operator, typed)
  if (!single.ok) return single
  return { ok: true, tokens: conditionTokens(suggestion, operator, single.value) }
}

function presetOptions(
  suggestion: FilterFieldSuggestion,
  typed: string,
  today: Date,
): FilterOption[] {
  if (!suggestion.datePicker) return []
  const needle = typed.toLowerCase()
  return datePresets(today)
    .filter((preset) => needle === '' || preset.label.toLowerCase().includes(needle))
    .map((preset) => ({
      kind: 'apply',
      tokens: rangeTokens(suggestion, preset.from, preset.to),
      label: `${preset.label} (${preset.from} – ${preset.to})`,
      group: 'Presets',
    }))
}

export function draftOptions(
  draft: FilterDraft,
  text: string,
  fields: FilterFields,
  current: FilterToken | undefined,
  today: Date = new Date(),
): FilterOptions {
  const suggestion = fields.get(draft.field)
  if (!suggestion) return { options: [], hint: null }
  const typed = text.trim()
  const options: FilterOption[] = []
  let hint: string | null = null

  if (suggestion.valueSource.kind === 'enum') {
    const operator = draft.operator === 'range' ? 'eq' : draft.operator
    const currentValue =
      current && current.field === draft.field ? current.values[0]?.toLowerCase() : undefined
    for (const option of enumMatches(suggestion, typed)) {
      options.push({
        kind: 'apply',
        tokens: [fieldToken(suggestion.field, operator, option.value)],
        label: option.label,
        group: fieldLabel(suggestion.field),
        selected: option.value.toLowerCase() === currentValue,
      })
    }
    if (options.length === 0 && typed !== '') {
      hint = `No ${fieldLabel(suggestion.field).toLowerCase()} matches “${typed}”.`
    }
  } else {
    const presets = presetOptions(suggestion, typed, today)
    const check = draftTokens(suggestion, draft.operator, typed)
    if (check.ok) {
      options.push({
        kind: 'apply',
        tokens: check.tokens,
        label: check.tokens.map((token) => describeToken(token, fields).sentence).join(' and '),
        group: fieldLabel(suggestion.field),
      })
    } else if (typed !== '' || presets.length === 0) {
      hint = check.message
    }
    options.push(...presets)
  }

  if (typed !== '') options.push(searchOption(typed))
  return { options, hint }
}
