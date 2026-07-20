import { describe, it, expect } from 'vitest'
import type { FilterFieldSuggestion } from '@opensaas/stack-core'
import { parseFilterQuery, buildFilterWhere, type FilterSpec } from '@opensaas/stack-core'
import { queryToState, stateToQuery } from '../../src/lib/filterBuilderState.js'

// A representative list's suggestion metadata: a free-text `title`, an enum
// `status`, and a numeric `views` (the shapes `collectFilterSuggestions`
// emits). These carry no functions — the whole point of the serializable seam.
const suggestions: FilterFieldSuggestion[] = [
  { field: 'title', operators: ['eq'], freeText: true, valueSource: { kind: 'none' } },
  {
    field: 'status',
    operators: ['eq'],
    freeText: false,
    valueSource: {
      kind: 'enum',
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'published', label: 'Published' },
      ],
    },
  },
  {
    field: 'views',
    operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
    freeText: false,
    valueSource: { kind: 'none' },
  },
]

// The matching Filter specs, so a builder-produced query can be run through the
// real engine (parse → buildFilterWhere) and asserted on the resulting `where`.
const specs: Record<string, FilterSpec> = {
  title: {
    operators: ['eq'],
    freeText: true,
    toCondition: (op, value) => (op === 'eq' ? { title: { contains: value } } : null),
    suggestions: { valueSource: { kind: 'none' } },
  },
  status: {
    operators: ['eq'],
    toCondition: (op, value) => (op === 'eq' ? { status: { equals: value } } : null),
    suggestions: { valueSource: { kind: 'enum', options: [] } },
  },
  views: {
    operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
    toCondition: (op, value) => {
      const n = Number(value)
      if (Number.isNaN(n)) return null
      const key = { eq: 'equals', gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte' }[op]
      return { views: { [key]: n } }
    },
    suggestions: { valueSource: { kind: 'none' } },
  },
}

describe('queryToState', () => {
  it('splits a field-scoped token into a structured row', () => {
    const { rows, freeText } = queryToState('status:published', suggestions)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ field: 'status', operator: 'eq', value: 'published' })
    expect(freeText).toBe('')
  })

  it('keeps bare words as free text', () => {
    const { rows, freeText } = queryToState('hello world', suggestions)
    expect(rows).toHaveLength(0)
    expect(freeText).toBe('hello world')
  })

  it('demotes an unknown field to free text (no matching suggestion)', () => {
    const { rows, freeText } = queryToState('nosuch:value', suggestions)
    expect(rows).toHaveLength(0)
    // Re-serialised so it survives round-trips; the engine would treat it as
    // free text anyway.
    expect(freeText).toBe('nosuch:value')
  })

  it('demotes a token using an operator the field does not support', () => {
    // `status` only supports eq; a `>` token degrades to free text.
    const { rows, freeText } = queryToState('status:>2', suggestions)
    expect(rows).toHaveLength(0)
    expect(freeText).toContain('status')
  })

  it('keeps a supported comparison operator as a structured row', () => {
    const { rows } = queryToState('views:>=10', suggestions)
    expect(rows[0]).toMatchObject({ field: 'views', operator: 'gte', value: '10' })
  })

  it('separates structured rows from trailing free text', () => {
    const { rows, freeText } = queryToState('status:draft beta', suggestions)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ field: 'status', value: 'draft' })
    expect(freeText).toBe('beta')
  })
})

describe('stateToQuery', () => {
  it('serialises a structured row into the grammar', () => {
    const query = stateToQuery({
      rows: [{ id: 'a', field: 'status', operator: 'eq', value: 'published' }],
      freeText: '',
    })
    expect(query).toBe('status:published')
  })

  it('quotes a value containing whitespace', () => {
    const query = stateToQuery({
      rows: [{ id: 'a', field: 'title', operator: 'eq', value: 'hello world' }],
      freeText: '',
    })
    expect(query).toBe('title:"hello world"')
  })

  it('drops rows with an empty field or value', () => {
    const query = stateToQuery({
      rows: [
        { id: 'a', field: 'status', operator: 'eq', value: '' },
        { id: 'b', field: '', operator: 'eq', value: 'x' },
        { id: 'c', field: 'status', operator: 'eq', value: 'draft' },
      ],
      freeText: '',
    })
    expect(query).toBe('status:draft')
  })

  it('combines structured rows with free text', () => {
    const query = stateToQuery({
      rows: [{ id: 'a', field: 'views', operator: 'gt', value: '5' }],
      freeText: 'beta',
    })
    expect(query).toBe('views:>5 beta')
  })
})

describe('round-trip through the real filter engine', () => {
  it('builds the expected Prisma where from a builder-produced query', () => {
    const query = stateToQuery({
      rows: [
        { id: 'a', field: 'status', operator: 'eq', value: 'published' },
        { id: 'b', field: 'views', operator: 'gte', value: '10' },
      ],
      freeText: 'hello',
    })

    const where = buildFilterWhere(parseFilterQuery(query), specs)

    expect(where).toEqual({
      AND: [
        { status: { equals: 'published' } },
        { views: { gte: 10 } },
        // free-text `hello` OR-matched across free-text fields (just `title`).
        { title: { contains: 'hello' } },
      ],
    })
  })

  it('is stable: state -> query -> state -> query', () => {
    const state = {
      rows: [
        { id: 'a', field: 'status', operator: 'eq' as const, value: 'draft' },
        { id: 'b', field: 'title', operator: 'eq' as const, value: 'Ada Lovelace' },
      ],
      freeText: 'beta gamma',
    }
    const query1 = stateToQuery(state)
    const rebuilt = queryToState(query1, suggestions)
    const query2 = stateToQuery(rebuilt)
    expect(query2).toBe(query1)
  })
})
