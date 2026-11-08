import {
  FILTER_COMPARISON_PREFIXES,
  effectiveFilterToken,
  filterQueryTokens,
  filterTermTokens,
  filterTokenFreeTextWord,
  filterTokenRecordId,
  filterValueRecordId,
  isEmptyFilterToken,
  isFieldConditionToken,
  parseFilterQuery,
  recordIdFilterToken,
  serializeFilterQuery,
  supportsFilterRange,
  type FilterFieldSuggestion,
  type FilterOperator,
  type FilterTerm,
  type FilterToken,
} from '@opensaas/stack-core'
import { formatFieldName } from './utils.js'

export type FilterFields = ReadonlyMap<string, FilterFieldSuggestion>

/**
 * A condition the Filter builder offers for a field: one of the field's own
 * operators, `range` ("between") on a field comparing both ways, or one the
 * engine composes around them.
 */
export type FilterBuilderCondition =
  FilterOperator | 'range' | 'not' | 'anyOf' | 'empty' | 'notEmpty'

export interface FilterDraft {
  field: string
  condition: FilterBuilderCondition
}

export interface FilterRange {
  low: string
  high: string
}

export interface FilterEntry {
  token: FilterToken
  group: number | null
}

export interface FilterChip {
  start: number
  count: number
  description: TokenDescription
  range: FilterRange | null
  group: number | null
}

export interface ChipUnit {
  first: number
  last: number
  group: number | null
}

export type GroupEdit = { ok: true; entries: FilterEntry[] } | { ok: false; message: string }

export const ALTERNATIVE_HINT =
  'An alternative is one filter. Choose a single filter, or quote words to search them as one phrase.'

export interface DatePreset {
  label: string
  from: string
  to: string
}

export interface FilterRecord {
  id: string
  label: string
}

export interface ResolvedFilterRecord {
  id: string
  label: string | null
}

export type RecordOf = (field: string, id: string) => ResolvedFilterRecord | undefined

export interface RecordLookup {
  records: FilterRecord[]
  loading: boolean
  searched: boolean
}

export type FilterOption =
  | { kind: 'field'; field: string; group: string }
  | {
      kind: 'apply'
      tokens: FilterToken[]
      label: string
      group: string
      selected?: boolean
      record?: { field: string } & FilterRecord
      entries?: FilterEntry[]
    }
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
const BETWEEN_PHRASE = /^(.+?)\s+between\s+(.+)$/i
const RANGE_WORDS = /\s+(?:to|and)\s+/i
const RANGE_DASHES = /[-–]/g
const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/
const FIELD_TOKEN_SHAPE = /[A-Za-z_][A-Za-z0-9_]*:\S/
const VALUE_FIRST_MIN_LENGTH = 2

export function fieldToken(
  field: string,
  operator: FilterOperator,
  value: string,
  negated = false,
): FilterToken {
  const quoted = operator === 'eq' && filterValueRecordId({ text: value, quoted: false }) !== null
  return { kind: 'token', field, operator, negated, values: [{ text: value, quoted }] }
}

export function rangeToken(field: string, low: string, high: string, negated = false): FilterToken {
  return {
    kind: 'token',
    field,
    operator: 'range',
    negated,
    values: [
      { text: low, quoted: false },
      { text: high, quoted: false },
    ],
  }
}

export function recordIdOf(
  token: FilterToken,
  fields: FilterFields,
  negated = false,
): string | null {
  if (token.field === null || token.negated !== negated) return null
  if (fields.get(token.field)?.matchesById !== true) return null
  return filterTokenRecordId({ ...token, negated: false })
}

export function isRecordLookupField(suggestion: FilterFieldSuggestion | undefined): boolean {
  return (
    suggestion?.matchesById === true &&
    suggestion.valueSource.kind === 'relationship' &&
    !suggestion.valueSource.many
  )
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
  return filterQueryTokens(parseFilterQuery(query)).filter((token) => !isEmptyFilterToken(token))
}

export function normaliseGroups(entries: readonly FilterEntry[]): FilterEntry[] {
  let id = -1
  return entries.map((entry, index) => {
    if (entry.group === null) return entry
    const previous = entries[index - 1]
    const next = entries[index + 1]
    const continues = previous !== undefined && previous.group === entry.group
    if (!continues) id++
    const alone = !continues && (next === undefined || next.group !== entry.group)
    const group = alone ? null : id
    return group === entry.group ? entry : { token: entry.token, group }
  })
}

export function nextGroupId(entries: readonly FilterEntry[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.group ?? -1), -1) + 1
}

export function hydrateEntries(query: string): FilterEntry[] {
  const entries = parseFilterQuery(query).terms.flatMap((term, index) =>
    filterTermTokens(term)
      .filter((token) => !isEmptyFilterToken(token))
      .map((token) => ({ token, group: term.kind === 'group' ? index : null })),
  )
  return normaliseGroups(entries)
}

export function entriesQuery(entries: readonly FilterEntry[]): string {
  const terms: FilterTerm[] = []
  let open: FilterToken[] | null = null
  normaliseGroups(entries.filter((entry) => !isEmptyFilterToken(entry.token))).forEach(
    (entry, index, all) => {
      if (entry.group === null) {
        open = null
        terms.push(entry.token)
        return
      }
      if (open === null || all[index - 1]?.group !== entry.group) {
        open = [entry.token]
        terms.push({ kind: 'group', tokens: open })
        return
      }
      open.push(entry.token)
    },
  )
  return serializeFilterQuery({ terms })
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
 * derive from the field's Filter spec alone: its own operators, "between" on a
 * field comparing both ways, "is not" (unless the spec says negation is
 * redundant) and, for an enumerated field, "is any of" around equality, and
 * "is empty" / "is not empty" where the field can be empty.
 */
export function conditionsOf(suggestion: FilterFieldSuggestion): FilterBuilderCondition[] {
  const conditions: FilterBuilderCondition[] = [...suggestion.operators]
  if (supportsFilterRange(suggestion.operators)) conditions.push('range')
  if (suggestion.operators.includes('eq')) {
    if (suggestion.negation !== 'redundant') conditions.push('not')
    if (suggestion.valueSource.kind === 'enum') conditions.push('anyOf')
  }
  if (suggestion.canBeEmpty === true) conditions.push('empty', 'notEmpty')
  return conditions
}

/** Whether a condition takes a typed value, rather than standing on its own. */
export function conditionTakesValue(condition: FilterBuilderCondition): boolean {
  return condition !== 'empty' && condition !== 'notEmpty'
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
  if (condition === 'range') return 'between'
  if (condition === 'not') return shapeLabel(suggestion, 'eq', true, false)
  if (condition === 'anyOf') return shapeLabel(suggestion, 'eq', false, true)
  return shapeLabel(suggestion, condition, false, false)
}

/**
 * The builder condition a field-condition token is edited under, or `null`
 * when the builder has no single condition for its shape (such as "is none of"
 * or "not between").
 */
export function conditionOfToken(token: FilterToken): FilterBuilderCondition | null {
  if (token.operator === 'empty') return token.negated ? 'notEmpty' : 'empty'
  if (token.operator === 'range') return token.negated ? null : 'range'
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

const pad = (value: number, width = 2) => String(Math.abs(value)).padStart(width, '0')

export function formatOffset(minutesBehindUtc: number): string {
  const ahead = -Math.round(minutesBehindUtc)
  const sign = ahead < 0 ? '-' : '+'
  return `${sign}${pad(Math.trunc(Math.abs(ahead) / 60))}:${pad(Math.abs(ahead) % 60)}`
}

export function localDay(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function localInstant(date: Date): string {
  const offset = date.getTimezoneOffset()
  if (!Number.isInteger(offset)) return date.toISOString()
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  const millis = pad(date.getMilliseconds(), 3)
  return `${localDay(date)}T${time}.${millis}${formatOffset(offset)}`
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

export function normaliseInstant(value: string, end: boolean): string | null {
  const typed = value.trim()
  const day = dayBoundary(typed, end)
  if (day !== null) return day
  const date = new Date(typed)
  if (Number.isNaN(date.getTime())) return null
  return ISO_INSTANT.test(typed) ? typed : localInstant(date)
}

function boundOf(suggestion: FilterFieldSuggestion, value: string, end: boolean): string {
  if (suggestion.datePicker !== 'instant') return value
  return normaliseInstant(value, end) ?? value
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
  negated = false,
): FilterToken[] {
  if (operator === 'eq' && suggestion.datePicker === 'instant') {
    const from = dayBoundary(value, false)
    const to = dayBoundary(value, true)
    if (from && to) return [rangeToken(suggestion.field, from, to, negated)]
  }
  const bound = boundOf(suggestion, value, endsTheDay(operator))
  return [fieldToken(suggestion.field, operator, bound, negated)]
}

export function rangeTokens(
  suggestion: FilterFieldSuggestion,
  low: string,
  high: string,
  negated = false,
): FilterToken[] {
  const from = boundOf(suggestion, low, false)
  const to = boundOf(suggestion, high, true)
  return [rangeToken(suggestion.field, from, to, negated)]
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

function optionLabel(suggestion: FilterFieldSuggestion, value: string): string {
  if (suggestion.valueSource.kind !== 'enum') return value
  const needle = value.toLowerCase()
  return (
    suggestion.valueSource.options.find((option) => option.value.toLowerCase() === needle)?.label ??
    value
  )
}

function effectiveToken(token: FilterToken, fields: FilterFields): FilterToken {
  const suggestion = token.field === null ? undefined : fields.get(token.field)
  return suggestion ? effectiveFilterToken(token, suggestion.operators) : token
}

export function isFieldCondition(
  token: FilterToken,
  fields: FilterFields,
): token is FilterToken & { field: string } {
  if (!isFieldConditionToken(token, (field) => fields.get(field))) return false
  const suggestion = fields.get(token.field)
  if (suggestion === undefined) return false
  const mapped = effectiveFilterToken(token, suggestion.operators)
  const operator = mapped.operator
  if (operator === 'empty') return true
  if (operator === 'range') {
    const [low, high] = mapped.values
    return (
      low !== undefined &&
      high !== undefined &&
      checkValue(suggestion, 'gte', low.text).ok &&
      checkValue(suggestion, 'lte', high.text).ok
    )
  }
  return valueTexts(mapped).every((text) => checkValue(suggestion, operator, text).ok)
}

function idConditionLabel(negated: boolean, many: boolean): string {
  if (negated) return many ? 'is none of' : 'is not'
  return many ? 'is any of' : 'is'
}

function describeRange(
  suggestion: FilterFieldSuggestion,
  range: FilterRange,
  negated = false,
): TokenDescription {
  const field = fieldLabel(suggestion.field)
  const low = displayBound(suggestion, range.low, false)
  const high = displayBound(suggestion, range.high, true)
  const condition = negated ? 'not between' : 'between'
  return {
    field,
    condition,
    value: `${low} – ${high}`,
    sentence: `${field} ${condition} ${low} and ${high}`,
  }
}

function displayValue(suggestion: FilterFieldSuggestion, operator: FilterOperator, value: string) {
  if (operator === 'eq') return optionLabel(suggestion, value)
  return displayBound(suggestion, value, endsTheDay(operator))
}

function rangeOf(token: FilterToken): FilterRange | null {
  if (token.operator !== 'range') return null
  const [low, high] = token.values
  return low && high ? { low: low.text, high: high.text } : null
}

export function describeToken(
  token: FilterToken,
  fields: FilterFields,
  recordOf: RecordOf = () => undefined,
): TokenDescription {
  const suggestion = token.field === null ? undefined : fields.get(token.field)
  if (suggestion && isFieldCondition(token, fields)) {
    const mapped = effectiveFilterToken(token, suggestion.operators)
    const operator = mapped.operator
    if (operator === 'range') {
      const [low, high] = mapped.values
      return describeRange(suggestion, { low: low.text, high: high.text }, mapped.negated)
    }
    const field = fieldLabel(suggestion.field)
    const values = mapped.values.filter((value) => value.text !== '')
    const ids =
      mapped.operator === 'eq' && suggestion.matchesById === true
        ? values.map(filterValueRecordId)
        : values.map(() => null)
    const records = ids.map((id) => (id === null ? null : recordOf(suggestion.field, id)))
    if (!records.includes(undefined)) {
      const byId = ids.length > 0 && ids.every((id) => id !== null)
      const many = values.length > 1
      const condition =
        operator === 'empty'
          ? conditionLabel(suggestion, mapped.negated ? 'notEmpty' : 'empty')
          : byId
            ? idConditionLabel(mapped.negated, many)
            : shapeLabel(suggestion, operator, mapped.negated, many)
      const value = values
        .map((written, index) => {
          const record = records[index]
          if (record) return record.label ?? record.id
          return operator === 'empty'
            ? written.text
            : displayValue(suggestion, operator, written.text)
        })
        .join(', ')
      const sentence = value ? `${field} ${condition} ${value}` : `${field} ${condition}`
      return { field, condition, value, sentence }
    }
  }
  const value = filterTokenFreeTextWord(token)
  return { field: 'Text', condition: 'contains', value, sentence: `Text contains ${value}` }
}

function pairedRange(
  first: FilterToken | undefined,
  second: FilterToken | undefined,
  fields: FilterFields,
): FilterRange | null {
  if (!first || !second || first.field === null || first.field !== second.field) return null
  if (first.negated || second.negated) return null
  if (first.values.length !== 1 || second.values.length !== 1) return null
  if (!isFieldCondition(first, fields) || !isFieldCondition(second, fields)) return null
  const [a] = first.values
  const [b] = second.values
  if (first.operator === 'gte' && second.operator === 'lte') return { low: a.text, high: b.text }
  if (first.operator === 'lte' && second.operator === 'gte') return { low: b.text, high: a.text }
  return null
}

export function chipsOf(
  entries: readonly FilterEntry[],
  fields: FilterFields,
  recordOf: RecordOf = () => undefined,
): FilterChip[] {
  const chips: FilterChip[] = []
  for (let start = 0; start < entries.length; start++) {
    const { token, group } = entries[start]
    const following = entries[start + 1]
    const suggestion = token.field === null ? undefined : fields.get(token.field)
    const paired =
      suggestion && group === null && following?.group === null
        ? pairedRange(token, following.token, fields)
        : null
    if (suggestion && paired) {
      chips.push({
        start,
        count: 2,
        description: describeRange(suggestion, paired),
        range: paired,
        group: null,
      })
      start++
      continue
    }
    const mapped = effectiveToken(token, fields)
    const range = !mapped.negated && isFieldCondition(token, fields) ? rangeOf(mapped) : null
    chips.push({
      start,
      count: 1,
      description: describeToken(token, fields, recordOf),
      range,
      group,
    })
  }
  return chips
}

export function unitsOf(chips: readonly FilterChip[]): ChipUnit[] {
  const units: ChipUnit[] = []
  chips.forEach((chip, index) => {
    const last = units.at(-1)
    if (last && chip.group !== null && last.group === chip.group) last.last = index
    else units.push({ first: index, last: index, group: chip.group })
  })
  return units
}

function unitAt(chips: readonly FilterChip[], index: number): ChipUnit | undefined {
  return unitsOf(chips).find((unit) => unit.first <= index && index <= unit.last)
}

function chipEntries(entries: readonly FilterEntry[], chip: FilterChip): FilterEntry[] {
  const own = entries.slice(chip.start, chip.start + chip.count)
  const field = own[0]?.token.field ?? null
  if (own.length !== 2 || chip.range === null || field === null) return own
  return [{ token: rangeToken(field, chip.range.low, chip.range.high), group: null }]
}

function memberRefusal(token: FilterToken, sentence: string): string | null {
  if (readsBackAs(token, true)) return null
  const fix =
    token.operator === 'range'
      ? ' Write each end of its range without spaces, commas or parentheses.'
      : ''
  return `“${sentence}” cannot be one alternative of an or group.${fix}`
}

function unitRefusal(
  entries: readonly FilterEntry[],
  chips: readonly FilterChip[],
  unit: ChipUnit,
): string | null {
  for (const chip of chips.slice(unit.first, unit.last + 1)) {
    for (const { token } of chipEntries(entries, chip)) {
      const refusal = memberRefusal(token, chip.description.sentence)
      if (refusal !== null) return refusal
    }
  }
  return null
}

export function alternativeRefusal(
  entries: readonly FilterEntry[],
  chips: readonly FilterChip[],
  index: number,
): string | null {
  const unit = unitAt(chips, index)
  return unit ? unitRefusal(entries, chips, unit) : null
}

function regroup(
  entries: readonly FilterEntry[],
  chips: readonly FilterChip[],
  groupOf: (index: number) => number | null | undefined,
  insert: { after: number; entries: FilterEntry[] } | null = null,
): FilterEntry[] {
  const next = chips.flatMap((chip, index) => {
    const group = groupOf(index)
    const own =
      group === undefined
        ? entries.slice(chip.start, chip.start + chip.count)
        : chipEntries(entries, chip).map((entry) => ({ token: entry.token, group }))
    return insert && insert.after === index ? [...own, ...insert.entries] : own
  })
  return normaliseGroups(next)
}

export function joinChips(
  entries: readonly FilterEntry[],
  chips: readonly FilterChip[],
  index: number,
): GroupEdit {
  const units = unitsOf(chips)
  const at = units.findIndex((unit) => unit.last === index)
  const left = units[at]
  const right = units[at + 1]
  if (left === undefined || right === undefined) return { ok: true, entries: [...entries] }
  const refusal = unitRefusal(entries, chips, left) ?? unitRefusal(entries, chips, right)
  if (refusal !== null) return { ok: false, message: refusal }
  const id = nextGroupId(entries)
  return {
    ok: true,
    entries: regroup(entries, chips, (chip) =>
      left.first <= chip && chip <= right.last ? id : undefined,
    ),
  }
}

export function splitChips(
  entries: readonly FilterEntry[],
  chips: readonly FilterChip[],
  index: number,
): FilterEntry[] {
  const unit = unitAt(chips, index)
  if (!unit || unit.group === null || index >= unit.last) return [...entries]
  const id = nextGroupId(entries)
  return regroup(entries, chips, (at) => (index < at && at <= unit.last ? id : undefined))
}

export function addAlternatives(
  entries: readonly FilterEntry[],
  chips: readonly FilterChip[],
  index: number,
  added: readonly FilterToken[],
  fields: FilterFields,
): GroupEdit {
  const [token, ...more] = added
  if (token === undefined || more.length > 0) return { ok: false, message: ALTERNATIVE_HINT }
  const unit = unitAt(chips, index)
  const refusal =
    memberRefusal(token, describeToken(token, fields).sentence) ??
    (unit ? unitRefusal(entries, chips, unit) : null)
  if (refusal !== null) return { ok: false, message: refusal }
  if (!unit) return { ok: true, entries: normaliseGroups([...entries, { token, group: null }]) }
  const id = unit.group ?? nextGroupId(entries)
  return {
    ok: true,
    entries: regroup(
      entries,
      chips,
      (at) => (unit.first <= at && at <= unit.last ? id : undefined),
      {
        after: unit.last,
        entries: [{ token, group: id }],
      },
    ),
  }
}

export function placeChoice(
  entries: readonly FilterEntry[],
  chips: readonly FilterChip[],
  added: readonly FilterEntry[],
  target: { alternativeOf: number | null; editing: FilterChip | null },
  fields: FilterFields,
  replace: boolean,
): GroupEdit {
  const { alternativeOf, editing } = target
  if (editing === null && alternativeOf !== null) {
    return addAlternatives(
      entries,
      chips,
      alternativeOf,
      added.map((entry) => entry.token),
      fields,
    )
  }
  if (editing !== null && editing.group !== null) {
    const [entry, ...more] = added
    if (entry === undefined || more.length > 0) return { ok: false, message: ALTERNATIVE_HINT }
    const refusal = memberRefusal(entry.token, describeToken(entry.token, fields).sentence)
    if (refusal !== null) return { ok: false, message: refusal }
    return {
      ok: true,
      entries: placeEntries(
        entries,
        [{ token: entry.token, group: editing.group }],
        editing,
        fields,
        false,
      ),
    }
  }
  const offset = nextGroupId(entries)
  const shifted = added.map((entry) => ({
    token: entry.token,
    group: entry.group === null ? null : entry.group + offset,
  }))
  return { ok: true, entries: placeEntries(entries, shifted, editing, fields, replace) }
}

export function singleTokenOptions({ options, hint }: FilterOptions): FilterOptions {
  const single = options.filter((option) => option.kind !== 'apply' || option.tokens.length === 1)
  return {
    options: single,
    hint: single.length < options.length ? (hint ?? ALTERNATIVE_HINT) : hint,
  }
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
    return { draft: { field: suggestion.field, condition: 'range' }, text: `${low}..${high}` }
  }
  if (recordIdOf(token, fields, token.negated) !== null) {
    return { draft: { field: suggestion.field, condition: token.negated ? 'not' : 'eq' }, text: '' }
  }
  const mapped = effectiveFilterToken(token, suggestion.operators)
  const condition = conditionOfToken(mapped)
  if (condition === null || !conditionsOf(suggestion).includes(condition)) {
    return { draft: null, text: editableText(token) }
  }
  const draft = { field: suggestion.field, condition }
  const operator = mapped.operator
  const [first] = mapped.values
  if (
    suggestion.valueSource.kind === 'enum' ||
    operator === 'empty' ||
    operator === 'range' ||
    first === undefined
  ) {
    return { draft, text: '' }
  }
  return {
    draft,
    text: operator === 'eq' ? first.text : displayValue(suggestion, operator, first.text),
  }
}

function isSingleChoice(token: FilterToken, fields: FilterFields): boolean {
  if (recordIdOf(token, fields) !== null) return true
  if (token.field === null || token.negated || !isFieldCondition(token, fields)) return false
  const mapped = effectiveToken(token, fields)
  if (mapped.operator !== 'eq' || mapped.values.length !== 1) return false
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

export function placeEntries(
  entries: readonly FilterEntry[],
  added: readonly FilterEntry[],
  at: { start: number; count: number } | null,
  fields: FilterFields,
  replace: boolean,
): FilterEntry[] {
  const loose = added.filter((entry) => entry.group === null).map((entry) => entry.token)
  const kept = replace ? new Set(lastChoicePerField(loose, fields)) : null
  const placed = added.filter(
    (entry) => entry.group !== null || kept === null || kept.has(entry.token),
  )
  const next = [...entries]
  if (at !== null && at.start < next.length) next.splice(at.start, at.count, ...placed)
  else next.push(...placed)
  if (!replace) return normaliseGroups(next)
  const chosen = new Set(
    placed
      .filter((entry) => entry.group === null && isSingleChoice(entry.token, fields))
      .map((entry) => entry.token.field),
  )
  return normaliseGroups(
    next.filter(
      (other) =>
        placed.includes(other) ||
        other.group !== null ||
        other.token.field === null ||
        !chosen.has(other.token.field) ||
        !isSingleChoice(other.token, fields),
    ),
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
  if (suggestion.datePicker === 'instant' && normaliseInstant(value, false) === null) {
    return { ok: false, message: `${label} takes a date or a time, like 2026-01-31.` }
  }
  return { ok: true, value }
}

type RangeCheck = { ok: true; low: string; high: string } | { ok: false; message: string }

type TokensCheck = { ok: true; tokens: FilterToken[] } | { ok: false; message: string }

interface RangeSplit {
  bounds: [string, string]
  dashed: boolean
}

function rangeSplits(text: string): RangeSplit[] {
  const dots = text.indexOf('..')
  if (dots >= 0) return [{ bounds: [text.slice(0, dots), text.slice(dots + 2)], dashed: false }]
  const words = RANGE_WORDS.exec(text)
  if (words) {
    const bounds: [string, string] = [
      text.slice(0, words.index),
      text.slice(words.index + words[0].length),
    ]
    return [{ bounds, dashed: false }]
  }
  return [...text.matchAll(RANGE_DASHES)]
    .map((match) => match.index)
    .filter((at) => at > 0 && at < text.length - 1)
    .map((at) => ({ bounds: [text.slice(0, at), text.slice(at + 1)], dashed: true }))
}

const bothDates = ([low, high]: [string, string]) =>
  plainDate(low.trim()) !== null && plainDate(high.trim()) !== null

function splitsAsRange(suggestion: FilterFieldSuggestion, text: string): boolean {
  return rangeSplits(text.trim()).some(
    ({ bounds, dashed }) => !dashed || !suggestion.datePicker || bothDates(bounds),
  )
}

export function checkRange(suggestion: FilterFieldSuggestion, raw: string): RangeCheck {
  const label = fieldLabel(suggestion.field)
  const typed = raw.trim()
  const shape = `Type a range for ${label}, as from..to.`
  if (typed === '') return { ok: false, message: shape }
  let firstMiss: string | null = null
  const fits: Array<[string, string]> = []
  for (const { bounds, dashed } of rangeSplits(typed)) {
    if (dashed && suggestion.datePicker && !bothDates(bounds)) continue
    const low = checkValue(suggestion, 'gte', bounds[0])
    const high = checkValue(suggestion, 'lte', bounds[1])
    if (low.ok && high.ok) fits.push([low.value, high.value])
    else firstMiss ??= !low.ok ? low.message : !high.ok ? high.message : null
  }
  if (fits.length === 1) return { ok: true, low: fits[0][0], high: fits[0][1] }
  return { ok: false, message: fits.length > 1 ? shape : (firstMiss ?? shape) }
}

function readsBackAs(token: FilterToken, inGroup: boolean): boolean {
  const terms: FilterTerm[] = inGroup ? [{ kind: 'group', tokens: [token, token] }] : [token]
  const [term, ...rest] = parseFilterQuery(serializeFilterQuery({ terms })).terms
  if (term === undefined || rest.length > 0 || (term.kind === 'group') !== inGroup) return false
  return filterTermTokens(term).every(
    (written) =>
      written.field === token.field &&
      written.operator === token.operator &&
      written.negated === token.negated &&
      written.values.length === token.values.length &&
      written.values.every((value, at) => value.text === token.values[at]?.text) &&
      filterTokenRecordId(written) === filterTokenRecordId(token),
  )
}

export function checkedRangeTokens(
  suggestion: FilterFieldSuggestion,
  low: string,
  high: string,
  negated = false,
): TokensCheck {
  const tokens = rangeTokens(suggestion, low, high, negated)
  if (readsBackAs(tokens[0], false)) return { ok: true, tokens }
  return {
    ok: false,
    message: `${fieldLabel(suggestion.field)} cannot take that range. Write each end without spaces or commas.`,
  }
}

export function normaliseTokens(
  tokens: readonly FilterToken[],
  fields: FilterFields,
): FilterToken[] {
  return tokens.flatMap((token) => {
    const suggestion = token.field === null ? undefined : fields.get(token.field)
    if (!suggestion || suggestion.datePicker !== 'instant' || !isFieldCondition(token, fields)) {
      return [token]
    }
    const mapped = effectiveFilterToken(token, suggestion.operators)
    const operator = mapped.operator
    if (operator === 'empty') return [token]
    if (operator === 'range') {
      const range = rangeOf(mapped)
      if (!range) return [token]
      const checked = checkedRangeTokens(suggestion, range.low, range.high, mapped.negated)
      return checked.ok ? checked.tokens : [token]
    }
    const [value] = mapped.values
    if (mapped.values.length !== 1 || value === undefined) return [token]
    return conditionTokens(suggestion, operator, value.text, mapped.negated)
  })
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

type PhraseResult = { kind: 'token'; tokens: FilterToken[] } | { kind: 'invalid'; message: string }

function emptyPhrase(text: string, fields: FilterFields): PhraseResult | null {
  const match = EMPTY_PHRASE.exec(text.trim())
  const suggestion = match ? findField(fields, match[1]) : undefined
  if (!match || !suggestion?.canBeEmpty) return null
  return { kind: 'token', tokens: [emptyToken(suggestion.field, match[2] !== undefined)] }
}

function betweenPhrase(text: string, fields: FilterFields): PhraseResult | null {
  const match = BETWEEN_PHRASE.exec(text.trim())
  const suggestion = match ? findField(fields, match[1]) : undefined
  if (!match || !suggestion) return null
  if (!supportsFilterRange(suggestion.operators)) {
    return { kind: 'invalid', message: `${fieldLabel(suggestion.field)} has no range.` }
  }
  const check = checkRange(suggestion, match[2])
  if (!check.ok) return { kind: 'invalid', message: check.message }
  const range = checkedRangeTokens(suggestion, check.low, check.high)
  if (!range.ok) return { kind: 'invalid', message: range.message }
  return { kind: 'token', tokens: range.tokens }
}

export function parsePhrase(text: string, fields: FilterFields): PhraseResult | null {
  const empty = emptyPhrase(text, fields)
  if (empty) return empty
  const between = betweenPhrase(text, fields)
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
    tokens: conditionTokens(suggestion, phrase.operator, check.value, phrase.negated),
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

  if (parseFilterQuery(typed).terms.some((term) => term.kind === 'group')) {
    return { options: groupedOptions(typed, fields), hint: null }
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
      offer(lastChoicePerField(normaliseTokens(terms, fields), fields), 'Suggestions')
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
      const tryRange =
        !comparison &&
        supportsFilterRange(suggestion.operators) &&
        (splitsAsRange(suggestion, rest) || suggestion.datePicker !== undefined)
      const range = tryRange ? checkRange(suggestion, rest) : null
      const ranged = range?.ok ? checkedRangeTokens(suggestion, range.low, range.high) : null
      if (ranged?.ok) {
        offer(ranged.tokens, 'Suggestions')
      } else if (check.ok && ranged === null) {
        offer(conditionTokens(suggestion, operator, check.value), 'Suggestions')
      } else if (ranged?.ok === false) {
        hint = ranged.message
      } else if (!check.ok) {
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
  const alternatives = alternativesOption(typed, fields)
  if (alternatives) options.push(alternatives)
  return { options, hint }
}

function entriesSentence(entries: readonly FilterEntry[], fields: FilterFields): string {
  const units: FilterEntry[][] = []
  entries.forEach((entry, index) => {
    const previous = entries[index - 1]
    const unit = units.at(-1)
    if (unit && entry.group !== null && previous?.group === entry.group) unit.push(entry)
    else units.push([entry])
  })
  const sentences = units.map((unit) => {
    const sentence = unit.map((entry) => describeToken(entry.token, fields).sentence).join(' or ')
    return unit.length > 1 && units.length > 1 ? `(${sentence})` : sentence
  })
  return sentences.join(' and ')
}

function entriesOption(entries: FilterEntry[], label: string, group: string): FilterOption {
  return { kind: 'apply', tokens: entries.map((entry) => entry.token), label, group, entries }
}

function typedEntries(typed: string, fields: FilterFields): FilterEntry[] {
  const entries = hydrateEntries(typed).map((entry) => ({
    token: normaliseTokens([entry.token], fields)[0] ?? entry.token,
    group: entry.group,
  }))
  const loose = entries.filter((entry) => entry.group === null).map((entry) => entry.token)
  const kept = new Set(lastChoicePerField(loose, fields))
  return entries.filter((entry) => entry.group !== null || kept.has(entry.token))
}

function groupedOptions(typed: string, fields: FilterFields): FilterOption[] {
  const entries = typedEntries(typed, fields)
  const searched = hydrateEntries(typed).map((entry) => ({
    token:
      entry.token.field === null
        ? entry.token
        : textToken(serializeFilterQuery({ terms: [entry.token] })),
    group: entry.group,
  }))
  const options = [entriesOption(entries, entriesSentence(entries, fields), 'Suggestions')]
  if (entriesQuery(searched) !== entriesQuery(entries)) {
    options.push(entriesOption(searched, `Search all text for “${typed}”`, 'Search'))
  }
  return options
}

const OR_WORD = /\s+or\s+/gi

function unquotedSides(text: string): Array<{ from: number; to: number; next: number }> {
  const quoted: boolean[] = []
  let inside = false
  for (let at = 0; at < text.length; at++) {
    if (text[at] === '\\' && inside) {
      quoted.push(true, true)
      at++
      continue
    }
    if (text[at] === '"') inside = !inside
    quoted.push(inside || text[at] === '"')
  }
  const sides: Array<{ from: number; to: number; next: number }> = []
  let from = 0
  for (const match of text.matchAll(OR_WORD)) {
    if (quoted[match.index]) continue
    sides.push({ from, to: match.index, next: match.index + match[0].length })
    from = match.index + match[0].length
  }
  sides.push({ from, to: text.length, next: text.length })
  return sides
}

function exactEnumTokens(typed: string, fields: FilterFields): FilterToken[] {
  const needle = typed.toLowerCase()
  return [...fields.values()].flatMap((suggestion) =>
    suggestion.valueSource.kind === 'enum'
      ? suggestion.valueSource.options
          .filter(
            (option) =>
              option.value.toLowerCase() === needle || option.label.toLowerCase() === needle,
          )
          .map((option) => fieldToken(suggestion.field, 'eq', option.value))
      : [],
  )
}

function alternativeTokens(text: string, fields: FilterFields): FilterToken[] {
  const typed = text.trim()
  if (FIELD_TOKEN_SHAPE.test(typed)) {
    const terms = hydrateTokens(typed)
    if (terms.length === 1 && isFieldCondition(terms[0], fields)) {
      return normaliseTokens(terms, fields)
    }
  }
  const phrase = parsePhrase(typed, fields)
  if (phrase?.kind === 'token') return phrase.tokens
  if (phrase?.kind === 'invalid') return []
  const values = exactEnumTokens(typed, fields)
  if (values.length > 0) return values
  return freeTextTokens(typed)
}

export function alternativesOption(text: string, fields: FilterFields): FilterOption | null {
  const typed = text.trim()
  const pieces = unquotedSides(typed)
  const sides: string[] = []
  for (let first = 0; first < pieces.length;) {
    let last = first
    for (let end = pieces.length - 1; end > first; end--) {
      if (exactEnumTokens(typed.slice(pieces[first].from, pieces[end].to), fields).length > 0) {
        last = end
        break
      }
    }
    sides.push(typed.slice(pieces[first].from, pieces[last].to))
    first = last + 1
  }
  if (sides.length < 2 || sides.some((side) => side.trim() === '')) return null
  const tokens: FilterToken[] = []
  for (const side of sides) {
    const read = alternativeTokens(side, fields)
    if (read.length !== 1) return null
    tokens.push(read[0])
  }
  return entriesOption(
    tokens.map((token) => ({ token, group: 0 })),
    tokens.map((token) => describeToken(token, fields).sentence).join(' or '),
    'Any of',
  )
}

/**
 * The tokens a typed value writes under a value-taking condition, or why it
 * cannot: `range` reads two bounds, `not` writes the negated form of the
 * comparison it is given, and a date field reads a typed span of two days as
 * a range under "is".
 */
export function draftTokens(
  suggestion: FilterFieldSuggestion,
  condition: FilterBuilderCondition,
  typed: string,
): TokensCheck {
  if (condition === 'range') {
    const range = checkRange(suggestion, typed)
    if (!range.ok) return range
    return checkedRangeTokens(suggestion, range.low, range.high)
  }
  const negated = condition === 'not'
  const comparison = negated ? splitComparison(suggestion, typed) : null
  const operator: FilterOperator | null = negated
    ? (comparison?.operator ?? 'eq')
    : condition === 'anyOf' || condition === 'empty' || condition === 'notEmpty'
      ? null
      : condition
  if (operator === null)
    return { ok: false, message: `Choose a value for ${fieldLabel(suggestion.field)}.` }
  const value = comparison?.rest ?? typed
  if (
    operator === 'eq' &&
    suggestion.datePicker !== undefined &&
    supportsFilterRange(suggestion.operators) &&
    splitsAsRange(suggestion, value)
  ) {
    const range = checkRange(suggestion, value)
    if (range.ok) return checkedRangeTokens(suggestion, range.low, range.high, negated)
  }
  const single = checkValue(suggestion, operator, value)
  if (!single.ok) return single
  return { ok: true, tokens: conditionTokens(suggestion, operator, single.value, negated) }
}

function presetOptions(
  suggestion: FilterFieldSuggestion,
  typed: string,
  today: Date,
  negated: boolean,
): FilterOption[] {
  if (!suggestion.datePicker || !supportsFilterRange(suggestion.operators)) return []
  const needle = typed.toLowerCase()
  return datePresets(today)
    .filter((preset) => needle === '' || preset.label.toLowerCase().includes(needle))
    .map((preset) => ({
      kind: 'apply',
      tokens: rangeTokens(suggestion, preset.from, preset.to, negated),
      label: `${negated ? 'Not ' : ''}${preset.label} (${preset.from} – ${preset.to})`,
      group: 'Presets',
    }))
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
  lookup: RecordLookup | null = null,
  today: Date = new Date(),
): FilterOptions {
  const suggestion = fields.get(draft.field)
  if (!suggestion) return { options: [], hint: null }
  const typed = text.trim()
  const options: FilterOption[] = []
  let hint: string | null = null
  const { condition } = draft

  if (lookup && isRecordLookupField(suggestion) && (condition === 'eq' || condition === 'not')) {
    const negated = condition === 'not'
    const currentId =
      current && current.field === draft.field ? recordIdOf(current, fields, negated) : null
    const group = fieldLabel(suggestion.field)
    const showRecords = typed === '' || lookup.searched
    for (const record of showRecords ? lookup.records : []) {
      options.push({
        kind: 'apply',
        tokens: [recordIdFilterToken(suggestion.field, record.id, negated)],
        label: record.label,
        group,
        selected: record.id === currentId,
        record: { field: suggestion.field, ...record },
      })
    }
    if (lookup.loading) hint = `Searching ${group.toLowerCase()}…`
    else if (showRecords && lookup.records.length === 0) {
      hint =
        typed === ''
          ? `No ${group.toLowerCase()} to choose from.`
          : `No ${group.toLowerCase()} matches “${typed}”.`
    }
    if (typed !== '') {
      const token = fieldToken(suggestion.field, 'eq', typed, negated)
      options.push({
        kind: 'apply',
        tokens: [token],
        label: describeToken(token, fields).sentence,
        group: 'Text',
      })
      options.push(searchOption(typed))
    }
    return { options, hint }
  }

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
  } else if (suggestion.valueSource.kind === 'enum') {
    const negated = condition === 'not'
    const operator: FilterOperator = condition === 'not' || condition === 'range' ? 'eq' : condition
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
    const presets = presetOptions(suggestion, typed, today, condition === 'not')
    const check = draftTokens(suggestion, condition, typed)
    if (check.ok) {
      options.push({
        kind: 'apply',
        tokens: check.tokens,
        label: sentenceOf(check.tokens, fields),
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
