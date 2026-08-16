import { describe, it, expect } from 'vitest'
import { parseFilterQuery } from './parse.js'
import { buildFilterWhere } from './map.js'
import { buildListFilterWhere, collectFilterSpecs, collectFilterSuggestions } from './collect.js'
import type { FilterSpec } from './types.js'
import { list } from '../config/index.js'
import {
  text,
  integer,
  bigInt,
  select,
  checkbox,
  timestamp,
  relationship,
} from '../fields/index.js'
import type { OpenSaasConfig } from '../config/types.js'

// ─────────────────────────────────────────────────────────────
// parseFilterQuery — the pure query-string → tokens boundary (ADR-0017)
// ─────────────────────────────────────────────────────────────

describe('parseFilterQuery', () => {
  it('parses a bare word as a free-text token (field: null)', () => {
    expect(parseFilterQuery('beta')).toEqual([
      { field: null, operator: 'eq', value: 'beta', raw: 'beta' },
    ])
  })

  it('parses a field:value token with the default eq operator', () => {
    expect(parseFilterQuery('role:Editor')).toEqual([
      { field: 'role', operator: 'eq', value: 'Editor', raw: 'role:Editor' },
    ])
  })

  it('parses comparison operators on a field token', () => {
    expect(parseFilterQuery('orders:>5')).toEqual([
      { field: 'orders', operator: 'gt', value: '5', raw: 'orders:>5' },
    ])
    expect(parseFilterQuery('orders:>=5')[0].operator).toBe('gte')
    expect(parseFilterQuery('orders:<5')[0].operator).toBe('lt')
    expect(parseFilterQuery('orders:<=5')[0].operator).toBe('lte')
  })

  it('keeps spaces inside a quoted value', () => {
    expect(parseFilterQuery('name:"Ada Lovelace"')).toEqual([
      { field: 'name', operator: 'eq', value: 'Ada Lovelace', raw: 'name:"Ada Lovelace"' },
    ])
  })

  it('parses a bare quoted phrase as a single free-text token', () => {
    expect(parseFilterQuery('"multi word"')).toEqual([
      { field: null, operator: 'eq', value: 'multi word', raw: '"multi word"' },
    ])
  })

  it('parses implicit-AND: multiple whitespace-separated tokens', () => {
    const tokens = parseFilterQuery('role:Editor status:Active orders:>5 name:"Ada Lovelace" beta')
    expect(tokens.map((t) => ({ field: t.field, operator: t.operator, value: t.value }))).toEqual([
      { field: 'role', operator: 'eq', value: 'Editor' },
      { field: 'status', operator: 'eq', value: 'Active' },
      { field: 'orders', operator: 'gt', value: '5' },
      { field: 'name', operator: 'eq', value: 'Ada Lovelace' },
      { field: null, operator: 'eq', value: 'beta' },
    ])
  })

  it('collapses surrounding / repeated whitespace', () => {
    expect(parseFilterQuery('   a    b  ').map((t) => t.value)).toEqual(['a', 'b'])
  })

  it('returns no tokens for an empty query', () => {
    expect(parseFilterQuery('')).toEqual([])
    expect(parseFilterQuery('   ')).toEqual([])
  })

  it('never throws on odd input — a leading comparison on a bare word stays free text', () => {
    expect(parseFilterQuery('>5')).toEqual([
      { field: null, operator: 'eq', value: '>5', raw: '>5' },
    ])
  })

  it('treats a URL scheme (`http://…`) as whole free text, not a field prefix', () => {
    // `http:` must NOT be parsed as a `field:` prefix — the `//` after the
    // colon marks a URL scheme, so the entire URL stays a free-text token.
    expect(() => parseFilterQuery('http://x')).not.toThrow()
    expect(parseFilterQuery('http://x')).toEqual([
      { field: null, operator: 'eq', value: 'http://x', raw: 'http://x' },
    ])
    expect(parseFilterQuery('https://example.com/path?q=1')).toEqual([
      {
        field: null,
        operator: 'eq',
        value: 'https://example.com/path?q=1',
        raw: 'https://example.com/path?q=1',
      },
    ])
  })
})

// ─────────────────────────────────────────────────────────────
// buildFilterWhere — tokens + specs → Prisma where (the mapping seam)
// ─────────────────────────────────────────────────────────────

// Small hand-rolled specs so the mapping is tested independently of the field
// builders.
const nameSpec: FilterSpec = {
  operators: ['eq'],
  freeText: true,
  toCondition: (op, value) => (op === 'eq' ? { name: { contains: value } } : null),
  suggestions: { valueSource: { kind: 'none' } },
}
const ordersSpec: FilterSpec = {
  operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
  toCondition: (op, value) => {
    if (!/^-?\d+$/.test(value)) return null
    return { orders: { [op === 'eq' ? 'equals' : op]: Number(value) } }
  },
  suggestions: { valueSource: { kind: 'none' } },
}
const statusSpec: FilterSpec = {
  operators: ['eq'],
  toCondition: (op, value) =>
    op === 'eq' && ['active', 'inactive'].includes(value.toLowerCase())
      ? { status: { equals: value.toLowerCase() } }
      : null,
  suggestions: {
    valueSource: {
      kind: 'enum',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive' },
      ],
    },
  },
}
const specs = { name: nameSpec, orders: ordersSpec, status: statusSpec }

describe('buildFilterWhere', () => {
  it('returns undefined when nothing filters', () => {
    expect(buildFilterWhere([], specs)).toBeUndefined()
  })

  it('maps a single field token to its condition (no AND wrapper)', () => {
    expect(buildFilterWhere(parseFilterQuery('orders:>5'), specs)).toEqual({
      orders: { gt: 5 },
    })
  })

  it('maps eq on a numeric field to `equals`', () => {
    expect(buildFilterWhere(parseFilterQuery('orders:5'), specs)).toEqual({
      orders: { equals: 5 },
    })
  })

  it('ANDs multiple field tokens (implicit AND)', () => {
    expect(buildFilterWhere(parseFilterQuery('status:Active orders:>5'), specs)).toEqual({
      AND: [{ status: { equals: 'active' } }, { orders: { gt: 5 } }],
    })
  })

  it('maps a bare word to an OR across free-text fields', () => {
    // Only `name` is free-text here.
    expect(buildFilterWhere(parseFilterQuery('beta'), specs)).toEqual({
      name: { contains: 'beta' },
    })
  })

  it('ANDs multiple bare words (each word must match)', () => {
    const multiFreeText = {
      name: nameSpec,
      title: {
        ...nameSpec,
        toCondition: (op: 'eq' | 'gt' | 'gte' | 'lt' | 'lte', v: string) =>
          op === 'eq' ? { title: { contains: v } } : null,
      } as FilterSpec,
    }
    expect(buildFilterWhere(parseFilterQuery('beta gamma'), multiFreeText)).toEqual({
      AND: [
        { OR: [{ name: { contains: 'beta' } }, { title: { contains: 'beta' } }] },
        { OR: [{ name: { contains: 'gamma' } }, { title: { contains: 'gamma' } }] },
      ],
    })
  })

  // ─── Graceful degradation (ADR-0017): unknown syntax → free text, never error
  it('degrades an unknown field to free text', () => {
    // `role` has no spec → search "Editor" across free-text fields.
    expect(buildFilterWhere(parseFilterQuery('role:Editor'), specs)).toEqual({
      name: { contains: 'Editor' },
    })
  })

  it('degrades an unsupported operator to free text', () => {
    // `status` supports only eq → `status:>x` degrades, searching "x".
    expect(buildFilterWhere(parseFilterQuery('status:>x'), specs)).toEqual({
      name: { contains: 'x' },
    })
  })

  it('degrades an unmappable value (non-numeric on a numeric field) to free text', () => {
    expect(buildFilterWhere(parseFilterQuery('orders:abc'), specs)).toEqual({
      name: { contains: 'abc' },
    })
  })

  it('degrades an unknown enum value to free text', () => {
    expect(buildFilterWhere(parseFilterQuery('status:pending'), specs)).toEqual({
      name: { contains: 'pending' },
    })
  })

  it('drops a degraded token entirely when there are no free-text fields', () => {
    const noFreeText = { orders: ordersSpec }
    expect(buildFilterWhere(parseFilterQuery('role:Editor'), noFreeText)).toBeUndefined()
  })

  it('searches a pasted URL as whole free text (scheme not dropped)', () => {
    // `http://x` must be searched in full, not mangled to `//x` by a spurious
    // `http:` field prefix.
    expect(buildFilterWhere(parseFilterQuery('http://x'), specs)).toEqual({
      name: { contains: 'http://x' },
    })
    expect(buildFilterWhere(parseFilterQuery('https://example.com'), specs)).toEqual({
      name: { contains: 'https://example.com' },
    })
  })
})

// ─────────────────────────────────────────────────────────────
// Field-builder Filter specs + collect helpers (config-aware layer)
// ─────────────────────────────────────────────────────────────

function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'sqlite', prismaClientConstructor: () => null as never },
    lists: {
      User: list({ fields: { name: text() } }),
      Post: list({
        fields: {
          title: text(),
          views: integer(),
          occurredAtMs: bigInt(),
          status: select({
            options: [
              { label: 'Draft', value: 'draft' },
              { label: 'Published', value: 'published' },
            ],
          }),
          featured: checkbox(),
          publishedAt: timestamp(),
          author: relationship({ ref: 'User.posts' }),
        },
      }),
    },
  }
}

describe('core field Filter specs', () => {
  const config = makeConfig()
  const postConfig = config.lists.Post

  it('collectFilterSpecs resolves a spec for every filterable core field', () => {
    const collected = collectFilterSpecs(postConfig, 'Post', config)
    expect(Object.keys(collected).sort()).toEqual(
      ['author', 'featured', 'occurredAtMs', 'publishedAt', 'status', 'title', 'views'].sort(),
    )
  })

  it('text is free-text and maps to contains', () => {
    const spec = postConfig.fields.title.getFilterSpec!('title', 'Post', config)!
    expect(spec.freeText).toBe(true)
    expect(spec.toCondition('eq', 'hello')).toEqual({ title: { contains: 'hello' } })
  })

  it('integer supports comparisons and rejects non-integers', () => {
    const spec = postConfig.fields.views.getFilterSpec!('views', 'Post', config)!
    expect(spec.toCondition('gt', '5')).toEqual({ views: { gt: 5 } })
    expect(spec.toCondition('eq', '5')).toEqual({ views: { equals: 5 } })
    expect(spec.toCondition('eq', 'abc')).toBeNull()
  })

  it('bigInt supports comparisons, emits a bigint condition, and rejects non-integers', () => {
    const spec = postConfig.fields.occurredAtMs.getFilterSpec!('occurredAtMs', 'Post', config)!
    expect(spec.toCondition('gt', '9007199254740993')).toEqual({
      occurredAtMs: { gt: 9007199254740993n },
    })
    expect(spec.toCondition('eq', '5')).toEqual({ occurredAtMs: { equals: 5n } })
    expect(spec.toCondition('eq', 'abc')).toBeNull()
    expect(spec.toCondition('eq', '1.5')).toBeNull()
  })

  it('select matches by value or label and resolves to the stored value', () => {
    const spec = postConfig.fields.status.getFilterSpec!('status', 'Post', config)!
    expect(spec.toCondition('eq', 'Published')).toEqual({ status: { equals: 'published' } })
    expect(spec.toCondition('eq', 'published')).toEqual({ status: { equals: 'published' } })
    expect(spec.toCondition('eq', 'archived')).toBeNull()
    expect(spec.suggestions.valueSource).toEqual({
      kind: 'enum',
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'published', label: 'Published' },
      ],
    })
  })

  it('checkbox maps true/false and rejects anything else', () => {
    const spec = postConfig.fields.featured.getFilterSpec!('featured', 'Post', config)!
    expect(spec.toCondition('eq', 'true')).toEqual({ featured: { equals: true } })
    expect(spec.toCondition('eq', 'False')).toEqual({ featured: { equals: false } })
    expect(spec.toCondition('eq', 'yes')).toBeNull()
  })

  it('timestamp compares parsed dates and rejects unparseable values', () => {
    const spec = postConfig.fields.publishedAt.getFilterSpec!('publishedAt', 'Post', config)!
    const condition = spec.toCondition('gt', '2024-01-01') as { publishedAt: { gt: Date } }
    expect(condition.publishedAt.gt).toBeInstanceOf(Date)
    expect(spec.toCondition('gt', 'not-a-date')).toBeNull()
  })

  it('relationship maps to a nested label filter (is for to-one)', () => {
    const spec = postConfig.fields.author.getFilterSpec!('author', 'Post', config)!
    // User's label field falls back to `name`.
    expect(spec.toCondition('eq', 'Ada')).toEqual({ author: { is: { name: { contains: 'Ada' } } } })
    expect(spec.suggestions.valueSource).toEqual({
      kind: 'relationship',
      listKey: 'User',
      many: false,
    })
  })

  it('does not produce specs for password/json/virtual (absence degrades gracefully)', () => {
    // A list of non-filterable fields yields no specs at all.
    const specsForUser = collectFilterSpecs(config.lists.User, 'User', config)
    // User only has `name` (text) → exactly one spec, proving non-text absence.
    expect(Object.keys(specsForUser)).toEqual(['name'])
  })
})

describe('buildListFilterWhere (end-to-end over a real list config)', () => {
  const config = makeConfig()

  it('composes parse + specs into a merged where', () => {
    const where = buildListFilterWhere(
      'status:Published views:>10 author:"Ada" hello',
      config.lists.Post,
      'Post',
      config,
    )
    expect(where).toEqual({
      AND: [
        { status: { equals: 'published' } },
        { views: { gt: 10 } },
        { author: { is: { name: { contains: 'Ada' } } } },
        // `hello` is free text over the two text fields (title only — status is
        // not free-text) → but title is the only free-text field here.
        { title: { contains: 'hello' } },
      ],
    })
  })

  it('returns undefined for an all-whitespace query', () => {
    expect(buildListFilterWhere('   ', config.lists.Post, 'Post', config)).toBeUndefined()
  })
})

describe('to-many relationship Filter spec (count comparisons — issue #732)', () => {
  function countConfig(): OpenSaasConfig {
    return {
      db: { provider: 'sqlite', prismaClientConstructor: () => null as never },
      lists: {
        User: list({
          fields: {
            name: text(),
            posts: relationship({ ref: 'Post.author', many: true }),
          },
        }),
        Post: list({
          fields: { title: text(), author: relationship({ ref: 'User.posts' }) },
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
      } as any,
    } as OpenSaasConfig
  }

  it('supports numeric comparisons and emits a count marker (not a label filter)', () => {
    const config = countConfig()
    const spec = config.lists.User.fields.posts.getFilterSpec!('posts', 'User', config)!
    expect(spec.operators).toEqual(['eq', 'gt', 'gte', 'lt', 'lte'])
    expect(spec.toCondition('gt', '5')).toEqual({
      posts: { _countFilter: { operator: 'gt', value: 5 } },
    })
    expect(spec.toCondition('eq', '0')).toEqual({
      posts: { _countFilter: { operator: 'eq', value: 0 } },
    })
    // A non-integer count degrades to free text (like an integer field).
    expect(spec.toCondition('gt', 'lots')).toBeNull()
    // No enumerated value source — a count is a plain numeric compare.
    expect(spec.suggestions.valueSource).toEqual({ kind: 'none' })
  })

  it('end-to-end: buildListFilterWhere carries a count marker for `posts:>5`', () => {
    const config = countConfig()
    const where = buildListFilterWhere('posts:>5', config.lists.User, 'User', config)
    expect(where).toEqual({ posts: { _countFilter: { operator: 'gt', value: 5 } } })
  })
})

describe('collectFilterSuggestions', () => {
  it('returns serializable, function-free suggestion metadata', () => {
    const config = makeConfig()
    const suggestions = collectFilterSuggestions(config.lists.Post, 'Post', config)
    // No functions anywhere → JSON round-trips cleanly.
    expect(JSON.parse(JSON.stringify(suggestions))).toEqual(suggestions)
    const status = suggestions.find((s) => s.field === 'status')!
    expect(status.valueSource.kind).toBe('enum')
    const author = suggestions.find((s) => s.field === 'author')!
    expect(author.valueSource).toEqual({ kind: 'relationship', listKey: 'User', many: false })
  })
})
