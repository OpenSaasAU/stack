import { describe, it, expect } from 'vitest'
import { filterQueryTokens, parseFilterQuery } from './parse.js'
import {
  buildFilterWhere,
  effectiveFilterToken,
  filterTokenFreeTextWord,
  isFieldConditionToken,
} from './map.js'
import { serializeFilterQuery, serializeFilterToken } from './serialize.js'
import {
  buildListFilterWhere,
  collectFilterSpecs,
  collectFilterSuggestions,
  collectUnreadableFields,
  type FilterAccessArgs,
} from './collect.js'
import type { FilterOperator, FilterSpec, FilterToken, FilterValue } from './types.js'
import { list } from '../config/index.js'
import {
  text,
  integer,
  bigInt,
  select,
  checkbox,
  timestamp,
  relationship,
  decimal,
  calendarDay,
} from '../fields/index.js'
import type { OpenSaasConfig } from '../config/types.js'
import type { AccessContext } from '../access/types.js'

const tokensOf = (written: string) => filterQueryTokens(parseFilterQuery(written))

// A permissive session/context — no field on any list under test declares
// field-level `read` access unless a test says so, so every field is
// filterable/sortable by default (matching `checkFieldAccess`'s own
// allow-by-default for a field with no rule).
const noAccessArgs: FilterAccessArgs = {
  session: null,
  context: { _isSudo: false } as unknown as AccessContext,
}

const READABLE = { operation: { query: () => true } }

// ─────────────────────────────────────────────────────────────
// parseFilterQuery — the pure query-string → structured query boundary
// ─────────────────────────────────────────────────────────────

const v = (text: string, quoted = false): FilterValue => ({ text, quoted })

const tok = (
  field: string | null,
  value: string,
  { quoted = false, ...partial }: Partial<FilterToken> & { quoted?: boolean } = {},
): FilterToken => ({
  kind: 'token',
  field,
  operator: 'eq',
  negated: false,
  values: [v(value, quoted)],
  ...partial,
})

const texts = (token: FilterToken) => token.values.map((value) => value.text)

describe('parseFilterQuery', () => {
  it('parses a bare word as a free-text token (field: null)', () => {
    expect(parseFilterQuery('beta')).toEqual({ terms: [tok(null, 'beta')] })
  })

  it('parses a field:value token with the default eq operator', () => {
    expect(parseFilterQuery('role:Editor')).toEqual({ terms: [tok('role', 'Editor')] })
  })

  it('parses comparison operators on a field token', () => {
    expect(parseFilterQuery('orders:>5')).toEqual({
      terms: [tok('orders', '5', { operator: 'gt' })],
    })
    expect(tokensOf('orders:>=5')[0].operator).toBe('gte')
    expect(tokensOf('orders:<5')[0].operator).toBe('lt')
    expect(tokensOf('orders:<=5')[0].operator).toBe('lte')
  })

  it('keeps spaces inside a quoted value', () => {
    expect(parseFilterQuery('name:"Ada Lovelace"')).toEqual({
      terms: [tok('name', 'Ada Lovelace', { quoted: true })],
    })
  })

  it('parses a bare quoted phrase as a single free-text token', () => {
    expect(parseFilterQuery('"multi word"')).toEqual({
      terms: [tok(null, 'multi word', { quoted: true })],
    })
  })

  it('parses implicit-AND: multiple whitespace-separated tokens', () => {
    const terms = tokensOf('role:Editor status:Active orders:>5 name:"Ada Lovelace" beta')
    expect(terms.map((t) => ({ field: t.field, operator: t.operator, values: texts(t) }))).toEqual([
      { field: 'role', operator: 'eq', values: ['Editor'] },
      { field: 'status', operator: 'eq', values: ['Active'] },
      { field: 'orders', operator: 'gt', values: ['5'] },
      { field: 'name', operator: 'eq', values: ['Ada Lovelace'] },
      { field: null, operator: 'eq', values: ['beta'] },
    ])
  })

  it('collapses surrounding / repeated whitespace', () => {
    expect(tokensOf('   a    b  ').map(texts)).toEqual([['a'], ['b']])
  })

  it('returns no terms for an empty query', () => {
    expect(parseFilterQuery('')).toEqual({ terms: [] })
    expect(parseFilterQuery('   ')).toEqual({ terms: [] })
  })

  it('never throws on odd input — a leading comparison on a bare word stays free text', () => {
    expect(parseFilterQuery('>5')).toEqual({ terms: [tok(null, '>5')] })
  })

  it('treats a URL scheme (`http://…`) as whole free text, not a field prefix', () => {
    expect(() => parseFilterQuery('http://x')).not.toThrow()
    expect(parseFilterQuery('http://x')).toEqual({ terms: [tok(null, 'http://x')] })
    expect(parseFilterQuery('https://example.com/path?q=1')).toEqual({
      terms: [tok(null, 'https://example.com/path?q=1')],
    })
  })

  it('reads a leading `-` followed by more of the token as negation', () => {
    expect(parseFilterQuery('-status:draft -beta --x - beta -"a b"')).toEqual({
      terms: [
        tok('status', 'draft', { negated: true }),
        tok(null, 'beta', { negated: true }),
        tok(null, '-x', { negated: true }),
        tok(null, '-'),
        tok(null, 'beta'),
        tok(null, 'a b', { negated: true, quoted: true }),
      ],
    })
  })

  it('reads a comma in a field value as a separator, each value quoted on its own', () => {
    expect(parseFilterQuery('status:draft,review , role:, status:a,"b c",d')).toEqual({
      terms: [
        tok('status', '', { values: [v('draft'), v('review')] }),
        tok(null, ','),
        tok('role', '', { values: [v(''), v('')] }),
        tok('status', '', { values: [v('a'), v('b c', true), v('d')] }),
      ],
    })
    expect(parseFilterQuery('status:"a,b"')).toEqual({
      terms: [tok('status', 'a,b', { quoted: true })],
    })
  })

  it('reads a comma in a free-text word as part of the word', () => {
    expect(parseFilterQuery('a,"b c"')).toEqual({
      terms: [tok(null, 'a,"b'), tok(null, 'c"')],
    })
  })

  it('reads `field:!` as the empty operator, and a quoted or longer `!` as a value', () => {
    expect(
      parseFilterQuery('status:! -status:! status:"!" status:!x status:!,a status:>!'),
    ).toEqual({
      terms: [
        tok('status', '', { operator: 'empty', values: [] }),
        tok('status', '', { operator: 'empty', values: [], negated: true }),
        tok('status', '!', { quoted: true }),
        tok('status', '!x'),
        tok('status', '', { values: [v('!'), v('a')] }),
        tok('status', '!', { operator: 'gt' }),
      ],
    })
    expect(parseFilterQuery('!')).toEqual({ terms: [tok(null, '!')] })
  })

  it('splits tokens on every whitespace character', () => {
    expect(tokensOf('a\u00a0b\fc\vd\u2028e').map(texts)).toEqual([
      ['a'],
      ['b'],
      ['c'],
      ['d'],
      ['e'],
    ])
  })

  it('keeps a quoted `"status:draft"` a free-text word, never a field token', () => {
    expect(parseFilterQuery('"status:draft"')).toEqual({
      terms: [tok(null, 'status:draft', { quoted: true })],
    })
  })

  it('reads `\\"` as a literal quote and `\\\\` as a backslash inside quotes', () => {
    expect(parseFilterQuery('name:"Ada \\"the Countess\\""')).toEqual({
      terms: [tok('name', 'Ada "the Countess"', { quoted: true })],
    })
    expect(parseFilterQuery('"ends in \\\\"')).toEqual({
      terms: [tok(null, 'ends in \\', { quoted: true })],
    })
  })

  it('keeps any other backslash inside quotes as itself', () => {
    expect(parseFilterQuery('"C:\\Users me"')).toEqual({
      terms: [tok(null, 'C:\\Users me', { quoted: true })],
    })
  })

  it('reads an unterminated quote to the end of the query', () => {
    expect(parseFilterQuery('"open ended')).toEqual({
      terms: [tok(null, 'open ended', { quoted: true })],
    })
  })
})

// ─────────────────────────────────────────────────────────────
// buildFilterWhere — query + specs → Where (the mapping seam)
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
  it.each(['constructor', '__proto__', 'toString'])(
    'degrades the inherited name %s to free text',
    (name) => {
      expect(() => buildFilterWhere(parseFilterQuery(`${name}:x`), specs)).not.toThrow()
    },
  )

  it('returns undefined when nothing filters', () => {
    expect(buildFilterWhere({ terms: [] }, specs)).toBeUndefined()
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
    expect(buildFilterWhere(parseFilterQuery('role:Editor'), specs)).toEqual({
      name: { contains: 'Editor' },
    })
  })

  it('degrades an unsupported operator to free text', () => {
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

  it('narrows to no rows — never drops — a degraded token when there are no free-text fields', () => {
    // `role:Editor` degrades (no spec for `role`), and there is nowhere to
    // search it: dropping the token would silently widen the result set, so
    // it must instead constrain the read to match nothing (#1356).
    const noFreeText = { orders: ordersSpec }
    expect(buildFilterWhere(parseFilterQuery('role:Editor'), noFreeText)).toEqual({ NOT: {} })
  })

  it('narrows to no rows when every free-text field rejects the degraded word too', () => {
    // A free-text field exists, but its own mapping still can't place the
    // word — same "cannot be honoured" outcome as having no free-text field
    // at all, so the result must be the same: narrowed, not widened (#1356).
    const rejectsEverything: FilterSpec = {
      operators: ['eq'],
      freeText: true,
      toCondition: () => null,
      suggestions: { valueSource: { kind: 'none' } },
    }
    expect(buildFilterWhere(parseFilterQuery('role:Editor'), { title: rejectsEverything })).toEqual(
      { NOT: {} },
    )
  })

  it('ANDs a never-matching word in with real conditions rather than dropping only that word', () => {
    // `status:Active` compiles; `role:Editor` cannot be honoured at all. The
    // whole chain must narrow to nothing, not just drop the bad term.
    const noFreeText = { orders: ordersSpec, status: statusSpec }
    expect(buildFilterWhere(parseFilterQuery('status:Active role:Editor'), noFreeText)).toEqual({
      AND: [{ status: { equals: 'active' } }, { NOT: {} }],
    })
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

  it('searches a quoted `"status:active"` as free text, never as the status field', () => {
    expect(buildFilterWhere(parseFilterQuery('"status:active"'), specs)).toEqual({
      name: { contains: 'status:active' },
    })
  })

  it('hands a field the unescaped value of a quoted token', () => {
    expect(buildFilterWhere(parseFilterQuery('name:"say \\"hi\\""'), specs)).toEqual({
      name: { contains: 'say "hi"' },
    })
  })

  it('negates a field condition: `-status:active` is NOT of status:active', () => {
    expect(buildFilterWhere(parseFilterQuery('-status:active'), specs)).toEqual({
      NOT: { status: { equals: 'active' } },
    })
    expect(buildFilterWhere(parseFilterQuery('-orders:>5'), specs)).toEqual({
      NOT: { orders: { gt: 5 } },
    })
  })

  it('ORs the field condition once per value: `status:active,inactive` is any of', () => {
    expect(buildFilterWhere(parseFilterQuery('status:active,inactive'), specs)).toEqual({
      OR: [{ status: { equals: 'active' } }, { status: { equals: 'inactive' } }],
    })
    expect(buildFilterWhere(parseFilterQuery('-status:active,inactive'), specs)).toEqual({
      NOT: { OR: [{ status: { equals: 'active' } }, { status: { equals: 'inactive' } }] },
    })
  })

  it('skips an empty value inside a list, and treats a list of empty values as inert', () => {
    expect(buildFilterWhere(parseFilterQuery('orders:5,'), specs)).toEqual({
      orders: { equals: 5 },
    })
    expect(buildFilterWhere(parseFilterQuery('role:,'), specs)).toBeUndefined()
  })

  it('searches a positive token that cannot map as one word, its values', () => {
    expect(buildFilterWhere(parseFilterQuery('status:active,pending'), specs)).toEqual({
      name: { contains: 'active,pending' },
    })
    expect(buildFilterWhere(parseFilterQuery('secret:a,b'), specs)).toEqual({
      name: { contains: 'a,b' },
    })
    expect(buildFilterWhere(parseFilterQuery('secret:"Ada Lovelace"'), specs)).toEqual({
      name: { contains: 'Ada Lovelace' },
    })
    expect(buildFilterWhere(parseFilterQuery('status:"!"'), specs)).toEqual({
      name: { contains: '!' },
    })
  })

  it('searches a negated token that cannot map as its whole literal, quotes included', () => {
    expect(buildFilterWhere(parseFilterQuery('-secret:"Ada Lovelace"'), specs)).toEqual({
      name: { contains: '-secret:"Ada Lovelace"' },
    })
  })

  it('searches the word its chip shows', () => {
    for (const written of ['status:active,pending', '-secret:x', 'role:"a b"', 'views:!']) {
      const [token] = tokensOf(written)
      expect(buildFilterWhere({ terms: [token] }, specs), written).toEqual({
        name: { contains: filterTokenFreeTextWord(token) },
      })
    }
  })

  it('never negates a token that cannot map: it is searched as the literal word', () => {
    expect(buildFilterWhere(parseFilterQuery('-secret:x'), specs)).toEqual({
      name: { contains: '-secret:x' },
    })
    expect(buildFilterWhere(parseFilterQuery('-status:active,pending'), specs)).toEqual({
      name: { contains: '-status:active,pending' },
    })
    expect(buildFilterWhere(parseFilterQuery('-status:>x'), specs)).toEqual({
      name: { contains: '-status:>x' },
    })
    expect(buildFilterWhere(parseFilterQuery('-beta -"a b"'), specs)).toEqual({
      AND: [{ name: { contains: '-beta' } }, { name: { contains: '-"a b"' } }],
    })
  })

  it('searches a comma in a free-text word as part of the word', () => {
    expect(buildFilterWhere(parseFilterQuery(','), specs)).toEqual({ name: { contains: ',' } })
    expect(buildFilterWhere(parseFilterQuery('beta,gamma'), specs)).toEqual({
      name: { contains: 'beta,gamma' },
    })
  })

  it('searches a structured token exactly as its serialised URL reads back', () => {
    const cases: FilterToken[] = [
      tok(null, 'a b', { negated: true }),
      tok('name', '', { values: [v('a b'), v('c')] }),
      tok('status', 'active', { negated: true }),
      tok(null, 'x', { negated: true, quoted: true }),
      tok('status', '', { values: [v('active'), v('inactive')] }),
      tok('orders', '', { values: [v('5'), v('')] }),
      tok('status', '', { operator: 'empty', values: [] }),
      tok(null, '', { values: [v('a'), v('b')] }),
      tok(null, '', { values: [v('a', true), v('b c')] }),
      tok(null, '', { negated: true, values: [v('a'), v('b')] }),
      tok('secret', '', { values: [v('a'), v('b')] }),
      tok('status', '', { values: [v('active'), v('bogus')] }),
    ]
    for (const token of cases) {
      const structured = { terms: [token] }
      const reparsed = parseFilterQuery(serializeFilterQuery(structured))
      expect(buildFilterWhere(structured, specs), JSON.stringify(token)).toEqual(
        buildFilterWhere(reparsed, specs),
      )
    }
  })
})

describe('buildFilterWhere — is empty, and "is not" keeps empty rows', () => {
  const emptiable: FilterSpec = { ...statusSpec, empty: { status: { equals: null } } }
  const withEmpty = { name: nameSpec, status: emptiable, orders: ordersSpec }

  it('maps `field:!` to the field’s empty condition and `-field:!` to its NOT', () => {
    expect(buildFilterWhere(parseFilterQuery('status:!'), withEmpty)).toEqual({
      status: { equals: null },
    })
    expect(buildFilterWhere(parseFilterQuery('-status:!'), withEmpty)).toEqual({
      NOT: { status: { equals: null } },
    })
  })

  it('degrades `field:!` to the literal word on a field that cannot be empty', () => {
    expect(buildFilterWhere(parseFilterQuery('orders:!'), withEmpty)).toEqual({
      name: { contains: 'orders:!' },
    })
    expect(buildFilterWhere(parseFilterQuery('-orders:!'), withEmpty)).toEqual({
      name: { contains: '-orders:!' },
    })
  })

  it('ORs the empty condition into a negated token', () => {
    expect(buildFilterWhere(parseFilterQuery('-status:active,inactive'), withEmpty)).toEqual({
      OR: [
        { NOT: { OR: [{ status: { equals: 'active' } }, { status: { equals: 'inactive' } }] } },
        { status: { equals: null } },
      ],
    })
  })

  it('leaves a positive token alone', () => {
    expect(buildFilterWhere(parseFilterQuery('status:active'), withEmpty)).toEqual({
      status: { equals: 'active' },
    })
  })
})

// ─────────────────────────────────────────────────────────────
// Empty-value tokens are a deliberate no-op, not narrowed (#1509)
//
// An empty value (`role:`, or a bare `""`) is incomplete input, not a
// constraint the system failed to compile — it must never reach a real
// free-text condition, because a `contains`-style mapping over `''` matches
// every row (the opposite of #1356's narrow-on-failure rule, which only
// applies to a token that DOES carry a value).
// ─────────────────────────────────────────────────────────────

describe('buildFilterWhere — empty-value tokens (#1509)', () => {
  it('produces no condition for a bare empty-string token, and never calls toCondition', () => {
    const calls: string[] = []
    const trackingName: FilterSpec = {
      ...nameSpec,
      toCondition: (op, value) => {
        calls.push(value)
        return nameSpec.toCondition(op, value)
      },
    }
    expect(buildFilterWhere(parseFilterQuery('""'), { name: trackingName })).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('produces no condition for a named-field empty-value token (`status:`), and never calls toCondition', () => {
    const calls: string[] = []
    const trackingStatus: FilterSpec = {
      ...statusSpec,
      toCondition: (op, value) => {
        calls.push(value)
        return statusSpec.toCondition(op, value)
      },
    }
    expect(
      buildFilterWhere(parseFilterQuery('status:'), { status: trackingStatus }),
    ).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('would let an empty value match every row if the guard were relaxed — proving the trap the guard closes', () => {
    // A realistic `contains`-style spec returns a non-null condition for ANY
    // value, empty string included — this is exactly what #1509 warns against:
    // `contains: ''` matches everything. If the early `token.value === ''`
    // guard in buildFilterWhere is ever relaxed to let the empty string flow
    // through to `freeTextWords`, this spec turns it into a real (wrong)
    // condition instead of `undefined`, and this assertion catches it.
    const containsEverything: FilterSpec = {
      operators: ['eq'],
      freeText: true,
      toCondition: (_op, value) => ({ name: { contains: value } }),
      suggestions: { valueSource: { kind: 'none' } },
    }
    expect(buildFilterWhere(parseFilterQuery('""'), { name: containsEverything })).toBeUndefined()
  })

  it('treats a structured token with no values as inert, never as an empty free-text word', () => {
    const containsEverything: FilterSpec = {
      operators: ['eq'],
      freeText: true,
      toCondition: (_op, value) => ({ name: { contains: value } }),
      suggestions: { valueSource: { kind: 'none' } },
    }
    expect(
      buildFilterWhere({ terms: [tok(null, '', { values: [] })] }, { name: containsEverything }),
    ).toBeUndefined()
    expect(buildFilterWhere({ terms: [tok('status', '', { values: [] })] }, specs)).toBeUndefined()
    expect(buildFilterWhere({ terms: [tok(null, '', { values: [] })] }, {})).toBeUndefined()
    expect(
      buildFilterWhere({ terms: [tok(null, '', { negated: true, values: [] })] }, specs),
    ).toBeUndefined()
  })

  it('treats a structured negated empty token as inert, exactly as the non-negated one', () => {
    const negatedEmpty = tok('status', '', { negated: true })
    expect(buildFilterWhere({ terms: [negatedEmpty] }, specs)).toBeUndefined()
  })

  it('leaves a non-empty token on the same field completely unaffected (#1356/#1504 unchanged)', () => {
    expect(buildFilterWhere(parseFilterQuery('status:Active'), specs)).toEqual({
      status: { equals: 'active' },
    })
  })

  it('contributes nothing when ANDed with a real condition, rather than narrowing the whole chain', () => {
    // Unlike an undegradable non-empty token (#1356), an empty value is inert
    // — it must not turn the chain into NEVER_MATCHES.
    expect(buildFilterWhere(parseFilterQuery('status:Active role:'), specs)).toEqual({
      status: { equals: 'active' },
    })
  })

  it('matches the no-token result exactly — `?filter=role:` behaves as if untyped', async () => {
    const config = makeConfig()
    const withEmptyValue = await buildListFilterWhere(
      'role:',
      config.lists.Post,
      'Post',
      config,
      noAccessArgs,
    )
    const withNoQuery = await buildListFilterWhere(
      '',
      config.lists.Post,
      'Post',
      config,
      noAccessArgs,
    )
    expect(withEmptyValue).toEqual(withNoQuery)
    expect(withEmptyValue).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────
// Field-builder Filter specs + collect helpers (config-aware layer)
// ─────────────────────────────────────────────────────────────

function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      User: list({ access: READABLE, fields: { name: text() } }),
      Post: list({
        access: READABLE,
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
          author: relationship({ ref: 'User' }),
        },
      }),
    },
  }
}

describe('core field Filter specs', () => {
  const config = makeConfig()
  const postConfig = config.lists.Post
  const oneToOneConfig: OpenSaasConfig = {
    db: { provider: 'postgresql' },
    lists: {
      AuthUser: list({
        access: READABLE,
        fields: {
          name: text(),
          profile: relationship({ ref: 'Profile.user', db: { isNullable: false } }),
        },
      }),
      Profile: list({
        access: READABLE,
        fields: { title: text(), user: relationship({ ref: 'AuthUser.profile' }) },
      }),
    },
  }

  it('collectFilterSpecs resolves a spec for every filterable core field', async () => {
    const collected = await collectFilterSpecs(postConfig, 'Post', config, noAccessArgs)
    expect(Object.keys(collected).sort()).toEqual(
      ['author', 'featured', 'occurredAtMs', 'publishedAt', 'status', 'title', 'views'].sort(),
    )
  })

  it.each<[string, FilterSpec | undefined, unknown]>([
    [
      'an optional text',
      text().getFilterSpec?.('f', 'Post', config),
      { OR: [{ f: { equals: null } }, { f: { equals: '' } }] },
    ],
    [
      'a non-null text',
      text({ db: { isNullable: false } }).getFilterSpec?.('f', 'Post', config),
      { f: { equals: '' } },
    ],
    [
      'a required text',
      text({ validation: { isRequired: true } }).getFilterSpec?.('f', 'Post', config),
      undefined,
    ],
    [
      'an optional integer',
      integer().getFilterSpec?.('f', 'Post', config),
      { f: { equals: null } },
    ],
    [
      'a required integer',
      integer({ validation: { isRequired: true } }).getFilterSpec?.('f', 'Post', config),
      undefined,
    ],
    [
      'an optional decimal',
      decimal().getFilterSpec?.('f', 'Post', config),
      { f: { equals: null } },
    ],
    ['an optional bigInt', bigInt().getFilterSpec?.('f', 'Post', config), { f: { equals: null } }],
    [
      'an optional calendar day',
      calendarDay().getFilterSpec?.('f', 'Post', config),
      { f: { equals: null } },
    ],
    [
      'an optional timestamp',
      timestamp().getFilterSpec?.('f', 'Post', config),
      { f: { equals: null } },
    ],
    [
      'a timestamp defaulting to now',
      timestamp({ defaultValue: { kind: 'now' } }).getFilterSpec?.('f', 'Post', config),
      undefined,
    ],
    ['a checkbox', checkbox().getFilterSpec?.('f', 'Post', config), undefined],
    [
      'a nullable checkbox',
      checkbox({ db: { isNullable: true } }).getFilterSpec?.('f', 'Post', config),
      { f: { equals: null } },
    ],
    [
      'an optional select',
      select({ options: [{ label: 'A', value: 'a' }] }).getFilterSpec?.('f', 'Post', config),
      { f: { equals: null } },
    ],
    [
      'a select with a default',
      select({ options: [{ label: 'A', value: 'a' }], defaultValue: 'a' }).getFilterSpec?.(
        'f',
        'Post',
        config,
      ),
      undefined,
    ],
    [
      'a to-one relationship',
      relationship({ ref: 'User' }).getFilterSpec?.('f', 'Post', config),
      { f: { none: {} } },
    ],
    [
      'a required to-one relationship',
      relationship({ ref: 'User', db: { isNullable: false } }).getFilterSpec?.('f', 'Post', config),
      undefined,
    ],
    [
      'the inverse side of a one-to-one, even when the owning side is required',
      oneToOneConfig.lists.Profile.fields.user.getFilterSpec?.('user', 'Profile', oneToOneConfig),
      { user: { none: {} } },
    ],
    [
      'the required owning side of a one-to-one',
      oneToOneConfig.lists.AuthUser.fields.profile.getFilterSpec?.(
        'profile',
        'AuthUser',
        oneToOneConfig,
      ),
      undefined,
    ],
    [
      'a to-many relationship, whose presence counts already say none',
      relationship({ ref: 'User', many: true }).getFilterSpec?.('f', 'Post', config),
      undefined,
    ],
  ])('states what empty means for %s only where it can be empty', (_case, spec, empty) => {
    expect(spec).toBeDefined()
    expect(spec?.empty).toEqual(empty)
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

  it('negates a to-one relationship with one NOT, since NOT some already includes none', async () => {
    expect(
      await buildListFilterWhere('-author:Ada', postConfig, 'Post', config, noAccessArgs),
    ).toEqual({ NOT: { author: { some: { name: { contains: 'Ada' } } } } })
    expect(
      await buildListFilterWhere('-author:!', postConfig, 'Post', config, noAccessArgs),
    ).toEqual({ NOT: { author: { none: {} } } })
  })

  it('states that negating a to-many presence count only restates it', () => {
    const spec = relationship({ ref: 'User', many: true }).getFilterSpec?.('f', 'Post', config)
    expect(spec?.negation).toBe('redundant')
    expect(spec?.empty).toBeUndefined()
  })

  it('relationship maps to a nested label filter (some, for either cardinality)', () => {
    const spec = postConfig.fields.author.getFilterSpec!('author', 'Post', config)!
    // User's label field falls back to `name`. Prisma 8 has no to-one
    // predicate form, so a label match is a `some` (ADR-0055).
    expect(spec.toCondition('eq', 'Ada')).toEqual({
      author: { some: { name: { contains: 'Ada' } } },
    })
    expect(spec.suggestions.valueSource).toEqual({
      kind: 'relationship',
      listKey: 'User',
      many: false,
    })
  })

  it('declines the filter when the related list has no conventional label field (#1359)', async () => {
    // Ledger has neither `name` nor `title`, and no `ui.labelField` — its
    // label resolves to `id`, which is never a declared field. A to-one
    // filter against it must decline rather than emit `contains` on `id`
    // (a Where-vocabulary refusal the engine would otherwise throw on).
    const gatedConfig: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Ledger: list({ access: READABLE, fields: { amount: integer() } }),
        Entry: list({ access: READABLE, fields: { ledger: relationship({ ref: 'Ledger' }) } }),
      },
    }
    const spec = gatedConfig.lists.Entry.fields.ledger.getFilterSpec!(
      'ledger',
      'Entry',
      gatedConfig,
    )
    expect(spec).toBeUndefined()

    // Both call paths degrade the same way — no spec means the token falls
    // back to free text where one exists, and to the never-matching
    // fragment where none does (#1356/#1504), so `ListView` and a direct
    // `buildListFilterWhere` caller behave identically instead of one
    // silently returning 0 results and the other throwing.
    const where = await buildListFilterWhere(
      'ledger:something',
      gatedConfig.lists.Entry,
      'Entry',
      gatedConfig,
      noAccessArgs,
    )
    expect(where).toEqual({ NOT: {} })
  })

  it('declines the filter when ui.labelField names a non-text field (#1359)', () => {
    // `contains` needs a real text column (ADR-0055's `ilike` accessor) — a
    // label explicitly pointed at an integer has none, the same failure
    // direction as the id-fallback case above, just reached explicitly
    // instead of by omission.
    const gatedConfig: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Ledger: list({
          access: READABLE,
          fields: { balance: integer() },
          ui: { labelField: 'balance' },
        }),
        Entry: list({ access: READABLE, fields: { ledger: relationship({ ref: 'Ledger' }) } }),
      },
    }
    const spec = gatedConfig.lists.Entry.fields.ledger.getFilterSpec!(
      'ledger',
      'Entry',
      gatedConfig,
    )
    expect(spec).toBeUndefined()
  })

  it('does not produce specs for password/json/virtual (absence degrades gracefully)', async () => {
    // A list of non-filterable fields yields no specs at all.
    const specsForUser = await collectFilterSpecs(config.lists.User, 'User', config, noAccessArgs)
    // User only has `name` (text) → exactly one spec, proving non-text absence.
    expect(Object.keys(specsForUser)).toEqual(['name'])
  })

  it('excludes a field the session cannot read (#915)', async () => {
    const gatedConfig: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Organisation: list({
          access: READABLE,
          fields: {
            name: text(),
            billingAddress: text({ access: { read: () => false } }),
          },
        }),
      },
    }
    const collected = await collectFilterSpecs(
      gatedConfig.lists.Organisation,
      'Organisation',
      gatedConfig,
      noAccessArgs,
    )
    expect(Object.keys(collected)).toEqual(['name'])
  })

  it('excludes a row-dependent read rule too — no row exists at predicate time (#915)', async () => {
    const gatedConfig: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Organisation: list({
          access: READABLE,
          fields: {
            name: text(),
            billingAddress: text({
              access: { read: ({ item, session }) => item.ownerId === session?.userId },
            }),
          },
        }),
      },
    }
    const collected = await collectFilterSpecs(
      gatedConfig.lists.Organisation,
      'Organisation',
      gatedConfig,
      noAccessArgs,
    )
    expect(Object.keys(collected)).toEqual(['name'])
  })
})

describe('collectUnreadableFields', () => {
  const rules = list({
    access: READABLE,
    fields: {
      name: text(),
      secret: text({ access: { read: () => false } }),
      ownNote: text({ access: { read: ({ item }) => item.name === 'Mine' } }),
      audit: text({ access: { read: ({ session }) => session?.role === 'admin' } }),
    },
  })

  it('names only the fields a row-independent rule denies this session', async () => {
    expect([...(await collectUnreadableFields(rules, noAccessArgs))].sort()).toEqual([
      'audit',
      'secret',
    ])
    expect([
      ...(await collectUnreadableFields(rules, { ...noAccessArgs, session: { role: 'admin' } })),
    ]).toEqual(['secret'])
  })

  it('names a field whose rule throws without reading the row, and spares its siblings', async () => {
    const throwing = list({
      access: READABLE,
      fields: {
        name: text(),
        broken: text({
          access: {
            read: () => {
              throw new Error('rule failed')
            },
          },
        }),
      },
    })
    expect([...(await collectUnreadableFields(throwing, noAccessArgs))]).toEqual(['broken'])
  })

  it('asks no field rule for a session denied the list', async () => {
    const asked = list({
      access: { operation: { query: () => false } },
      fields: {
        title: text({
          access: {
            read: () => {
              throw new Error('asked')
            },
          },
        }),
      },
    })
    expect([...(await collectUnreadableFields(asked, noAccessArgs))]).toEqual([])
  })
})

describe('buildListFilterWhere (end-to-end over a real list config)', () => {
  const config = makeConfig()

  it('composes parse + specs into a merged where', async () => {
    const where = await buildListFilterWhere(
      'status:Published views:>10 author:"Ada" hello',
      config.lists.Post,
      'Post',
      config,
      noAccessArgs,
    )
    expect(where).toEqual({
      AND: [
        { status: { equals: 'published' } },
        { views: { gt: 10 } },
        { author: { some: { name: { contains: 'Ada' } } } },
        // `hello` is free text over the two text fields (title only — status is
        // not free-text) → but title is the only free-text field here.
        { title: { contains: 'hello' } },
      ],
    })
  })

  it('returns undefined for an all-whitespace query', async () => {
    expect(
      await buildListFilterWhere('   ', config.lists.Post, 'Post', config, noAccessArgs),
    ).toBeUndefined()
  })

  it('a read-denied field degrades to free text instead of reaching the engine (#915)', async () => {
    const gatedConfig: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Organisation: list({
          access: READABLE,
          fields: {
            name: text(),
            billingAddress: text({ access: { read: () => false } }),
          },
        }),
      },
    }
    // `billingAddress:12` never produces `{ billingAddress: { contains: '12' } }`
    // — the spec is excluded, so the token degrades to a free-text search for
    // "12" across `name` (the only remaining free-text field) instead.
    const where = await buildListFilterWhere(
      'billingAddress:12',
      gatedConfig.lists.Organisation,
      'Organisation',
      gatedConfig,
      noAccessArgs,
    )
    expect(where).toEqual({ name: { contains: '12' } })
  })
})

describe('to-many relationship Filter spec (presence — issue #732, ADR-0055)', () => {
  function countConfig(): OpenSaasConfig {
    return {
      db: { provider: 'postgresql' },
      lists: {
        User: list({
          access: READABLE,
          fields: {
            name: text(),
            posts: relationship({ ref: 'Post.author', many: true }),
          },
        }),
        Post: list({
          access: READABLE,
          fields: { title: text(), author: relationship({ ref: 'User.posts' }) },
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
      } as any,
    } as OpenSaasConfig
  }

  it('shrinks a count comparison to presence, and degrades the rest', () => {
    const config = countConfig()
    const spec = config.lists.User.fields.posts.getFilterSpec!('posts', 'User', config)!
    expect(spec.operators).toEqual(['eq', 'gt', 'gte'])
    expect(spec.toCondition('eq', '0')).toEqual({ posts: { none: {} } })
    expect(spec.toCondition('gt', '0')).toEqual({ posts: { some: {} } })
    expect(spec.toCondition('gte', '1')).toEqual({ posts: { some: {} } })
    expect(spec.toCondition('gte', '0')).toBeNull()
    expect(spec.toCondition('lt', '0')).toBeNull()
    // Prisma 8 cannot compare a relation count in a `where`, so a bookmarked
    // `posts:>5` stops filtering rather than erroring — it degrades to free
    // text under ADR-0017's own degradation rule.
    expect(spec.toCondition('gt', '5')).toBeNull()
    expect(spec.toCondition('lt', '3')).toBeNull()
    expect(spec.toCondition('gt', 'lots')).toBeNull()
    expect(spec.suggestions.valueSource).toEqual({ kind: 'none' })
  })

  it('end-to-end: `posts:>0` becomes a presence filter and `posts:>5` degrades', async () => {
    const config = countConfig()
    expect(
      await buildListFilterWhere('posts:>0', config.lists.User, 'User', config, noAccessArgs),
    ).toEqual({ posts: { some: {} } })
    expect(
      await buildListFilterWhere('posts:>=1', config.lists.User, 'User', config, noAccessArgs),
    ).toEqual({ posts: { some: {} } })
    expect(
      await buildListFilterWhere('posts:>5', config.lists.User, 'User', config, noAccessArgs),
    ).toEqual({ name: { contains: '5' } })
  })
})

describe('collectFilterSuggestions', () => {
  it('returns serializable, function-free suggestion metadata', async () => {
    const config = makeConfig()
    const suggestions = await collectFilterSuggestions(
      config.lists.Post,
      'Post',
      config,
      noAccessArgs,
    )
    // No functions anywhere → JSON round-trips cleanly.
    expect(JSON.parse(JSON.stringify(suggestions))).toEqual(suggestions)
    const status = suggestions.find((s) => s.field === 'status')!
    expect(status.valueSource.kind).toBe('enum')
    const author = suggestions.find((s) => s.field === 'author')!
    expect(author.valueSource).toEqual({ kind: 'relationship', listKey: 'User', many: false })
  })

  it('says which fields can be empty, and only those', async () => {
    const config = makeConfig()
    const suggestions = await collectFilterSuggestions(
      config.lists.Post,
      'Post',
      config,
      noAccessArgs,
    )
    expect(
      suggestions
        .filter((suggestion) => suggestion.canBeEmpty === true)
        .map((suggestion) => suggestion.field)
        .sort(),
    ).toEqual(['author', 'occurredAtMs', 'publishedAt', 'status', 'title', 'views'])
    expect(suggestions.find((s) => s.field === 'featured')?.canBeEmpty).toBeUndefined()
  })

  it('carries how a field negates', async () => {
    const config = makeConfig()
    const suggestions = await collectFilterSuggestions(
      config.lists.Post,
      'Post',
      config,
      noAccessArgs,
    )
    expect(suggestions.find((s) => s.field === 'author')?.negation).toBe('includesEmpty')
    expect(suggestions.find((s) => s.field === 'title')?.negation).toBeUndefined()
  })

  it('excludes a read-denied field from the suggestion metadata (#915)', async () => {
    const gatedConfig: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Organisation: list({
          access: READABLE,
          fields: {
            name: text(),
            billingAddress: text({ access: { read: () => false } }),
          },
        }),
      },
    }
    const suggestions = await collectFilterSuggestions(
      gatedConfig.lists.Organisation,
      'Organisation',
      gatedConfig,
      noAccessArgs,
    )
    expect(suggestions.map((s) => s.field)).toEqual(['name'])
  })

  const POSTS_CONFIG: OpenSaasConfig = {
    db: { provider: 'postgresql' },
    lists: {
      User: list({
        access: READABLE,
        fields: { posts: relationship({ ref: 'Post.author', many: true }) },
      }),
      Post: list({ access: READABLE, fields: { author: relationship({ ref: 'User.posts' }) } }),
    },
  }

  it.each([
    ['integer', integer(), ['12', '-3', ' 7 '], ['1.5', 'ten', '1e3', '']],
    ['bigInt', bigInt(), ['9007199254740993', '-1'], ['1e3', '1.0']],
    ['decimal', decimal(), ['1.25', '-4', '0'], ['1,000', 'abc', '1.', '.5']],
    [
      'calendarDay',
      calendarDay(),
      ['2026-01-31', '2024-02-29'],
      ['31/01/2026', '2026-1-31', '2026-13-01', '2026-13-45', '2026-00-10', '2026-01-32'],
    ],
  ])(
    'states a %s value format that agrees with what the spec maps',
    async (_type, field, fits, misfits) => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql' },
        lists: { Thing: list({ access: READABLE, fields: { value: field } }) },
      }
      const [suggestion] = await collectFilterSuggestions(
        config.lists.Thing,
        'Thing',
        config,
        noAccessArgs,
      )
      const spec = field.getFilterSpec?.('value', 'Thing', config)
      expect(spec?.suggestions.valueFormat).toEqual(suggestion.valueFormat)
      const pattern = new RegExp(suggestion.valueFormat?.pattern ?? '(?!)')
      for (const operator of spec?.operators ?? []) {
        for (const value of fits) {
          expect(pattern.test(value.trim()), value).toBe(true)
          expect(spec?.toCondition(operator, value), value).not.toBeNull()
        }
        for (const value of misfits) {
          expect(pattern.test(value.trim()), value).toBe(false)
          expect(spec?.toCondition(operator, value), value).toBeNull()
        }
      }
    },
  )

  it('leaves a calendar day the month lacks to the engine, which refuses it', () => {
    const field = calendarDay()
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: { Thing: list({ access: READABLE, fields: { value: field } }) },
    }
    const spec = field.getFilterSpec?.('value', 'Thing', config)
    const pattern = new RegExp(spec?.suggestions.valueFormat?.pattern ?? '(?!)')
    for (const day of ['2026-02-31', '2025-02-29', '2026-04-31']) {
      expect(pattern.test(day), day).toBe(true)
      expect(spec?.toCondition('eq', day), day).toBeNull()
    }
  })

  it('states no timestamp value format, and maps anything Date parses', async () => {
    const field = timestamp()
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: { Thing: list({ access: READABLE, fields: { value: field } }) },
    }
    const [suggestion] = await collectFilterSuggestions(
      config.lists.Thing,
      'Thing',
      config,
      noAccessArgs,
    )
    expect(suggestion.valueFormat).toBeUndefined()
    const spec = field.getFilterSpec?.('value', 'Thing', config)
    expect(spec?.toCondition('eq', 'Jan 31 2026')).toEqual({
      value: { equals: new Date('Jan 31 2026') },
    })
    expect(spec?.toCondition('gt', '2026-01-31T10:00:00+10:00')).toEqual({
      value: { gt: new Date('2026-01-31T00:00:00.000Z') },
    })
    expect(spec?.toCondition('eq', '2026-13-45')).toBeNull()
  })

  it('states a to-many value format that admits only the presence counts the spec maps', async () => {
    const suggestions = await collectFilterSuggestions(
      POSTS_CONFIG.lists.User,
      'User',
      POSTS_CONFIG,
      noAccessArgs,
    )
    const suggestion = suggestions.find((entry) => entry.field === 'posts')
    const spec = POSTS_CONFIG.lists.User.fields.posts.getFilterSpec?.('posts', 'User', POSTS_CONFIG)
    expect(suggestion?.operators).toEqual(['eq', 'gt', 'gte'])
    const table: Array<[FilterOperator, string[], string[]]> = [
      ['eq', ['0', ' 0 '], ['1', '5', '-1', '00', 'none', '']],
      ['gt', ['0'], ['1', '5', '-1', '00']],
      ['gte', ['1', ' 1 '], ['0', '2', '5', '01']],
    ]
    expect(table.map(([operator]) => operator)).toEqual(spec?.operators)
    for (const [operator, fits, misfits] of table) {
      const format = suggestion?.valueFormat
      const pattern = new RegExp(
        format?.operators?.[operator]?.pattern ?? format?.pattern ?? '(?!)',
      )
      for (const value of fits) {
        expect(pattern.test(value.trim()), `${operator} ${value}`).toBe(true)
        expect(spec?.toCondition(operator, value), `${operator} ${value}`).not.toBeNull()
      }
      for (const value of misfits) {
        expect(pattern.test(value.trim()), `${operator} ${value}`).toBe(false)
        expect(spec?.toCondition(operator, value), `${operator} ${value}`).toBeNull()
      }
    }
  })
})

describe('ranges (`field:a..b`)', () => {
  it('parses an unquoted field value with `..` as one inclusive range token', () => {
    expect(tokensOf('orders:5..10')).toEqual([
      tok('orders', '', { operator: 'range', values: [v('5'), v('10')] }),
    ])
    expect(tokensOf('at:2026-11-01T00:00:00.000+11:00..2026-11-01T23:59:59.999+11:00')).toEqual([
      tok('at', '', {
        operator: 'range',
        values: [v('2026-11-01T00:00:00.000+11:00'), v('2026-11-01T23:59:59.999+11:00')],
      }),
    ])
  })

  it('splits at the first `..`', () => {
    expect(tokensOf('orders:1...5')).toEqual([
      tok('orders', '', { operator: 'range', values: [v('1'), v('.5')] }),
    ])
  })

  it.each(['orders:..5', 'orders:5..', 'orders:..', 'orders:"5..10"'])(
    'reads %s as a single literal value, never a range',
    (written) => {
      const [term] = tokensOf(written)
      expect(term.operator).toBe('eq')
      expect(term.values).toHaveLength(1)
    },
  )

  it.each(['5..10', '>5..10', '"5..10"'])('never reads the free-text word %s as a range', (w) => {
    expect(tokensOf(w)[0].field).toBeNull()
  })

  it('keeps a comparison operator ahead of `..` as a comparison on the literal value', () => {
    expect(tokensOf('orders:>=5..10')).toEqual([tok('orders', '5..10', { operator: 'gte' })])
  })

  it.each([
    'orders:5..10',
    'orders:1...5',
    'orders:"5..10"',
    'orders:>=5..10',
    'orders:5..10 beta',
  ])('serialize(parse(%s)) reproduces the query', (written) => {
    expect(serializeFilterQuery(parseFilterQuery(written))).toBe(written)
  })

  it('quotes an eq value that would otherwise read back as a range', () => {
    expect(serializeFilterQuery({ terms: [tok('orders', '5..10')] })).toBe('orders:"5..10"')
  })

  it('writes a range whose bounds cannot be written bare as one literal value', () => {
    const range = tok('title', '', { operator: 'range', values: [v('a b'), v('c')] })
    const written = serializeFilterQuery({ terms: [range] })
    expect(written).toBe('title:"a b..c"')
    expect(tokensOf(written)[0].operator).toBe('eq')
  })

  it('lowers a range to the field’s own gte and lte conditions, ANDed', () => {
    expect(buildFilterWhere(parseFilterQuery('orders:5..10'), specs)).toEqual({
      AND: [{ orders: { gte: 5 } }, { orders: { lte: 10 } }],
    })
  })

  it('maps a range through any spec comparing both ways, never a hard-coded field type', () => {
    const calls: Array<[FilterOperator, string]> = []
    const thirdParty: FilterSpec = {
      operators: ['gte', 'lte'],
      toCondition: (operator, value) => {
        calls.push([operator, value])
        return { score: { [operator]: value } }
      },
      suggestions: { valueSource: { kind: 'none' } },
    }
    expect(buildFilterWhere(parseFilterQuery('score:b..y'), { score: thirdParty })).toEqual({
      AND: [{ score: { gte: 'b' } }, { score: { lte: 'y' } }],
    })
    expect(calls).toEqual([
      ['gte', 'b'],
      ['lte', 'y'],
    ])
  })

  it.each([
    ['orders:abc..10', 'abc..10'],
    ['orders:5..ten', '5..ten'],
    ['status:a..b', 'a..b'],
    ['nosuch:1..2', '1..2'],
  ])('degrades the invalid range %s to free text', (written, word) => {
    expect(buildFilterWhere(parseFilterQuery(written), specs)).toEqual({
      name: { contains: word },
    })
  })

  it.each(['name:wait...what', 'name:v1..v2', 'name:a..b@x'])(
    'keeps %s on a field with no range as that field’s eq on the literal value',
    (written) => {
      const literal = written.slice('name:'.length)
      expect(buildFilterWhere(parseFilterQuery(written), specs)).toEqual({
        name: { contains: literal },
      })
      expect(buildFilterWhere(parseFilterQuery(written), specs)).toEqual(
        buildFilterWhere(parseFilterQuery(`name:"${literal}"`), specs),
      )
      expect(serializeFilterQuery(parseFilterQuery(written))).toBe(written)
    },
  )

  it('reads a range token on a field with no range as a field condition, on its literal', () => {
    const lookup: Record<string, FilterSpec> = specs
    const operatorsFor = (field: string) => {
      const spec = lookup[field]
      return spec === undefined ? undefined : { operators: spec.operators }
    }
    const [token] = tokensOf('name:v1..v2')
    expect(isFieldConditionToken(token, operatorsFor)).toBe(true)
    expect(effectiveFilterToken(token, specs.name.operators)).toEqual(
      tok('name', 'v1..v2', { operator: 'eq' }),
    )
    const [ranged] = tokensOf('orders:1..2')
    expect(effectiveFilterToken(ranged, specs.orders.operators)).toBe(ranged)
  })

  it('degrades a structured range with an empty bound as its serialised URL reads back', () => {
    const range = tok('orders', '', { operator: 'range', values: [v(''), v('10')] })
    expect(buildFilterWhere({ terms: [range] }, specs)).toEqual({
      name: { contains: '..10' },
    })
  })

  it('reads a negated range as one negated range token, written back as it was', () => {
    expect(tokensOf('-orders:5..10')).toEqual([
      tok('orders', '', { operator: 'range', negated: true, values: [v('5'), v('10')] }),
    ])
    expect(serializeFilterQuery(parseFilterQuery('-orders:5..10'))).toBe('-orders:5..10')
  })

  it('lowers a negated range to NOT of the ANDed bounds, keeping the rows with no value', () => {
    const range = { AND: [{ orders: { gte: 5 } }, { orders: { lte: 10 } }] }
    const nullable: FilterSpec = { ...specs.orders, empty: { orders: { equals: null } } }
    expect(buildFilterWhere(parseFilterQuery('-orders:5..10'), specs)).toEqual({ NOT: range })
    expect(buildFilterWhere(parseFilterQuery('-orders:5..10'), { orders: nullable })).toEqual({
      OR: [{ NOT: range }, { orders: { equals: null } }],
    })
    expect(
      buildFilterWhere(parseFilterQuery('-orders:5..10'), {
        orders: { ...nullable, negation: 'includesEmpty' },
      }),
    ).toEqual({ NOT: range })
  })

  it('searches a negated range that cannot map as its whole literal, never negated', () => {
    const [token] = tokensOf('-orders:abc..10')
    expect(filterTokenFreeTextWord(token)).toBe('-orders:abc..10')
    expect(buildFilterWhere(parseFilterQuery('-orders:abc..10'), specs)).toEqual({
      name: { contains: '-orders:abc..10' },
    })
  })

  it('searches a positive range that cannot map as its literal `a..b`', () => {
    const [token] = tokensOf('nosuch:1..2')
    expect(filterTokenFreeTextWord(token)).toBe('1..2')
  })

  it('reads a negated range on a field with no range as that field’s negated eq on its literal', () => {
    expect(buildFilterWhere(parseFilterQuery('-name:v1..v2'), specs)).toEqual(
      buildFilterWhere(parseFilterQuery('-name:"v1..v2"'), specs),
    )
  })

  it('never reads a list as a range: `a..b,c` is eq on each value', () => {
    const [token] = tokensOf('orders:1..2,3')
    expect(token.operator).toBe('eq')
    expect(texts(token)).toEqual(['1..2', '3'])
    expect(serializeFilterQuery(parseFilterQuery('orders:1..2,3'))).toBe('orders:1..2,3')
  })

  it('filters a range the same rows as the two comparisons it stands for', () => {
    expect(buildFilterWhere(parseFilterQuery('orders:>=5 orders:<=10'), specs)).toEqual(
      buildFilterWhere(parseFilterQuery('orders:5..10'), specs),
    )
  })

  it('states a date picker on timestamp and calendarDay suggestions, and none elsewhere', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Thing: list({
          access: READABLE,
          fields: { at: timestamp(), day: calendarDay(), count: integer() },
        }),
      },
    }
    const suggestions = await collectFilterSuggestions(
      config.lists.Thing,
      'Thing',
      config,
      noAccessArgs,
    )
    expect(Object.fromEntries(suggestions.map((s) => [s.field, s.datePicker]))).toEqual({
      at: 'instant',
      day: 'day',
      count: undefined,
    })
  })
})

// ─────────────────────────────────────────────────────────────
// OR groups (ADR-0083): `(a OR b)`
// ─────────────────────────────────────────────────────────────

const orGroup = (...tokens: FilterToken[]) => ({ kind: 'group' as const, tokens })

describe('parseFilterQuery reads OR groups', () => {
  it('reads `(a OR b)` as one group term', () => {
    expect(parseFilterQuery('(status:active OR name:ada) orders:>5')).toEqual({
      terms: [
        orGroup(tok('status', 'active'), tok('name', 'ada')),
        tok('orders', '5', { operator: 'gt' }),
      ],
    })
  })

  it('reads every token shape inside a group', () => {
    expect(
      parseFilterQuery(
        '(-status:active OR status:a,b OR status:! OR orders:1..5 OR author:#42 OR beta)',
      ),
    ).toEqual({
      terms: [
        orGroup(
          tok('status', 'active', { negated: true }),
          tok('status', '', { values: [v('a'), v('b')] }),
          tok('status', '', { operator: 'empty', values: [] }),
          tok('orders', '', { operator: 'range', values: [v('1'), v('5')] }),
          tok('author', '#42'),
          tok(null, 'beta'),
        ),
      ],
    })
  })

  it('reads a quoted member, including one ending in `)`, and a closing `)` after a quote', () => {
    expect(parseFilterQuery('(name:"Ada (Countess)" OR "OR")')).toEqual({
      terms: [
        orGroup(tok('name', 'Ada (Countess)', { quoted: true }), tok(null, 'OR', { quoted: true })),
      ],
    })
  })

  it.each([
    ['(a OR f(x) y)', ['(a', 'OR', 'f(x)', 'y)']],
    ['(see OR note(1) later)', ['(see', 'OR', 'note(1)', 'later)']],
    ['(a OR b))', ['(a', 'OR', 'b))']],
    ['(a OR status:x(1))', ['(a', 'OR', 'status:x(1))']],
  ])('keeps %s as the literal words it was before groups existed', (written, words) => {
    const { terms } = parseFilterQuery(written)
    expect(terms.every((term) => term.kind === 'token')).toBe(true)
    expect(filterQueryTokens({ terms }).map(serializeFilterToken)).toEqual(words)
    expect(serializeFilterQuery(parseFilterQuery(written))).toBe(written)
  })

  it('reads a member whose parenthesis is quoted', () => {
    expect(parseFilterQuery('("f(x)" OR name:"a)")')).toEqual({
      terms: [orGroup(tok(null, 'f(x)', { quoted: true }), tok('name', 'a)', { quoted: true }))],
    })
  })

  it.each([
    '(a OR f(x) y)',
    '(see OR note(1) later)',
    '(a OR b))',
    '((a OR b))',
    '(a) OR (b)',
    '(a OR (b) OR c)',
    '(f(x) OR y)',
    '(a OR b)(c OR d)',
    '(a OR b)) (c OR d',
    '(x:(1 OR y:2))',
    '(-(a OR b))',
    'f(x) (g OR h(i))',
    '(status:a,b(c) OR d)',
    '(a OR "b" c)',
  ])('reads %s as the same terms as before groups existed', (written) => {
    const wordByWord = written
      .split(/\s+/)
      .filter((word) => word !== '')
      .flatMap((word) => parseFilterQuery(word).terms)
    expect(parseFilterQuery(written).terms).toEqual(wordByWord)
  })

  it.each([
    ['a lowercase keyword', '(a or b)', ['(a', 'or', 'b)']],
    ['a quoted keyword', '(a "OR" b)', ['(a', 'OR', 'b)']],
    ['no parentheses', 'a OR b', ['a', 'OR', 'b']],
    ['an unmatched opening parenthesis', '(a OR b', ['(a', 'OR', 'b']],
    ['an unmatched closing parenthesis', 'a OR b)', ['a', 'OR', 'b)']],
    ['a nested group', '((a OR b) OR c)', ['((a', 'OR', 'b)', 'OR', 'c)']],
    ['a group of one', '(a)', ['(a)']],
    ['a space inside the parentheses', '( a OR b )', ['(', 'a', 'OR', 'b', ')']],
    ['a dangling keyword', '(a OR)', ['(a', 'OR)']],
    ['text after the closer', '(a OR b)c', ['(a', 'OR', 'b)c']],
    ['a negated group', '-(a OR b)', ['(a', 'OR', 'b)']],
  ])('degrades %s to literal words', (_case, written, words) => {
    const { terms } = parseFilterQuery(written)
    expect(terms.every((term) => term.kind === 'token')).toBe(true)
    expect(filterQueryTokens({ terms }).map((token) => token.values[0]?.text)).toEqual(words)
    expect(serializeFilterQuery(parseFilterQuery(written))).toBe(written)
  })

  it('finds a valid group after an unmatched parenthesis', () => {
    expect(parseFilterQuery('(a (b OR c)').terms).toEqual([
      tok(null, '(a'),
      orGroup(tok(null, 'b'), tok(null, 'c')),
    ])
  })
})

describe('serializeFilterQuery writes OR groups', () => {
  it.each([
    '(status:active OR name:ada) orders:>5',
    '(-status:active OR status:a,b OR status:! OR orders:1..5 OR author:#42 OR beta)',
    '(name:"Ada (Countess)" OR "OR")',
    '(a OR b))',
    '(a OR OR OR b)',
    '"OR" (a OR -)',
  ])('reproduces %s', (written) => {
    expect(serializeFilterQuery(parseFilterQuery(written))).toBe(written)
  })

  it('writes a range inside a group as one `a..b` token', () => {
    expect(
      serializeFilterQuery({
        terms: [
          orGroup(
            tok('orders', '', { operator: 'range', values: [v('1'), v('5')] }),
            tok('status', 'active'),
          ),
        ],
      }),
    ).toBe('(orders:1..5 OR status:active)')
  })

  it('writes a group of one as its token, and an empty group as nothing', () => {
    expect(serializeFilterQuery({ terms: [orGroup(tok('status', 'active')), orGroup()] })).toBe(
      'status:active',
    )
  })

  it('quotes a member that would end the group early or open a nested one', () => {
    expect(
      serializeFilterQuery({
        terms: [orGroup(tok(null, 'a)'), tok(null, '(b'), tok('x', 'c)'))],
      }),
    ).toBe('("a)" OR "(b" OR x:"c)")')
  })

  it('quotes a free-text word outside a group that would read back as one', () => {
    const words = { terms: [tok(null, '(a'), tok(null, 'OR'), tok(null, 'b)')] }
    expect(serializeFilterQuery(words)).toBe('"(a" OR b)')
    expect(parseFilterQuery(serializeFilterQuery(words)).terms).toHaveLength(3)
  })
})

describe('buildFilterWhere lowers OR groups', () => {
  it('ORs each member through its own condition', () => {
    expect(buildFilterWhere(parseFilterQuery('(status:active OR orders:>5)'), specs)).toEqual({
      OR: [{ status: { equals: 'active' } }, { orders: { gt: 5 } }],
    })
  })

  it('ANDs a group with the rest of the query', () => {
    expect(
      buildFilterWhere(parseFilterQuery('(status:active OR orders:>5) name:ada'), specs),
    ).toEqual({
      AND: [
        { OR: [{ status: { equals: 'active' } }, { orders: { gt: 5 } }] },
        { name: { contains: 'ada' } },
      ],
    })
  })

  it('keeps two values on one field in a group', () => {
    expect(buildFilterWhere(parseFilterQuery('(status:active OR status:inactive)'), specs)).toEqual(
      {
        OR: [{ status: { equals: 'active' } }, { status: { equals: 'inactive' } }],
      },
    )
  })

  it('negates a member by the same rules as outside a group', () => {
    expect(buildFilterWhere(parseFilterQuery('(-status:active OR orders:1..5)'), specs)).toEqual({
      OR: [
        { NOT: { status: { equals: 'active' } } },
        { AND: [{ orders: { gte: 1 } }, { orders: { lte: 5 } }] },
      ],
    })
  })

  it('keeps an unmappable member in place as its free-text alternative', () => {
    expect(buildFilterWhere(parseFilterQuery('(status:active OR nosuch:Findable)'), specs)).toEqual(
      {
        OR: [{ status: { equals: 'active' } }, { name: { contains: 'Findable' } }],
      },
    )
  })

  it('keeps a negated unmappable member as its literal word, never negated', () => {
    expect(buildFilterWhere(parseFilterQuery('(status:active OR -secret:x)'), specs)).toEqual({
      OR: [{ status: { equals: 'active' } }, { name: { contains: '-secret:x' } }],
    })
  })

  it('narrows an unmappable member to nothing where there is no free-text field', () => {
    expect(
      buildFilterWhere(parseFilterQuery('(orders:>5 OR nosuch:x)'), { orders: ordersSpec }),
    ).toEqual({ OR: [{ orders: { gt: 5 } }, { NOT: {} }] })
  })

  it('skips an empty member, and a group of empty members filters nothing', () => {
    expect(buildFilterWhere(parseFilterQuery('(status:active OR status:)'), specs)).toEqual({
      status: { equals: 'active' },
    })
    expect(buildFilterWhere(parseFilterQuery('(status: OR "")'), specs)).toBeUndefined()
  })

  it('searches degraded parentheses as the literal words they are', () => {
    expect(buildFilterWhere(parseFilterQuery('(a OR b'), specs)).toEqual({
      AND: [
        { name: { contains: '(a' } },
        { name: { contains: 'OR' } },
        { name: { contains: 'b' } },
      ],
    })
  })
})
