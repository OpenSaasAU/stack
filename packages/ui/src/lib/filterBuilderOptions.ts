import {
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

export interface FilterDraft {
  field: string
  operator: FilterOperator
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

const COMPARISON_LABELS: Record<Exclude<FilterOperator, 'eq'>, string> = {
  gt: 'greater than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
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
const FIELD_TOKEN_SHAPE = /[A-Za-z_][A-Za-z0-9_]*:\S/
const VALUE_FIRST_MIN_LENGTH = 2

export function fieldToken(field: string, operator: FilterOperator, value: string): FilterToken {
  return { kind: 'token', field, operator, negated: false, values: [value], quoted: false }
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

function eqMatchesPart(suggestion: FilterFieldSuggestion): boolean {
  return suggestion.freeText || suggestion.valueSource.kind === 'relationship'
}

export function conditionLabel(
  suggestion: FilterFieldSuggestion,
  operator: FilterOperator,
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
  if (token.values.length !== 1 || !isFieldConditionToken(token, operatorsOf(fields))) return false
  const suggestion = fields.get(token.field)
  return suggestion !== undefined && checkValue(suggestion, token.values[0]).ok
}

export function describeToken(token: FilterToken, fields: FilterFields): TokenDescription {
  const suggestion = token.field === null ? undefined : fields.get(token.field)
  if (suggestion && isFieldCondition(token, fields)) {
    const field = fieldLabel(suggestion.field)
    const condition = conditionLabel(suggestion, token.operator)
    const value = optionLabel(suggestion, token.values[0])
    return { field, condition, value, sentence: `${field} ${condition} ${value}` }
  }
  const value =
    token.field === null && !token.negated && token.values.length === 1
      ? token.values[0]
      : serializeFilterQuery({ terms: [token] })
  return { field: 'Text', condition: 'contains', value, sentence: `Text contains ${value}` }
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

export function checkValue(suggestion: FilterFieldSuggestion, raw: string): ValueCheck {
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
  if (suggestion.valueFormat && !matchesFormat(suggestion.valueFormat.pattern, value)) {
    return { ok: false, message: `${label} ${suggestion.valueFormat.description}.` }
  }
  return { ok: true, value }
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

type PhraseResult = { kind: 'token'; token: FilterToken } | { kind: 'invalid'; message: string }

export function parsePhrase(text: string, fields: FilterFields): PhraseResult | null {
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
  const check = checkValue(suggestion, match[3])
  if (!check.ok) return { kind: 'invalid', message: check.message }
  return { kind: 'token', token: fieldToken(suggestion.field, operator, check.value) }
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
      const check = checkValue(suggestion, comparison?.rest ?? rest)
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

  if (suggestion.valueSource.kind === 'enum') {
    const currentValue =
      current && current.field === draft.field ? current.values[0]?.toLowerCase() : undefined
    for (const option of enumMatches(suggestion, typed)) {
      options.push({
        kind: 'apply',
        tokens: [fieldToken(suggestion.field, draft.operator, option.value)],
        label: option.label,
        group: fieldLabel(suggestion.field),
        selected: option.value.toLowerCase() === currentValue,
      })
    }
    if (options.length === 0 && typed !== '') {
      hint = `No ${fieldLabel(suggestion.field).toLowerCase()} matches “${typed}”.`
    }
  } else {
    const check = checkValue(suggestion, typed)
    if (check.ok) {
      const token = fieldToken(suggestion.field, draft.operator, check.value)
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

  if (typed !== '') options.push(searchOption(typed))
  return { options, hint }
}
