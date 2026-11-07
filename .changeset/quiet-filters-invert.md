---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Core owns one structured filter query, with a parser and serialiser that are true inverses (ADR-0083)

Breaking: `FilterToken` drops `value` and `raw` for `kind`, `negated`, `values` and `quoted`, and `parseFilterQuery`, `serializeFilterQuery` and `buildFilterWhere` now take or return a `FilterQuery`. `@opensaas/stack-ui` removes `queryToState`, `stateToQuery`, `FilterRow` and `FilterBuilderState`.

`parseFilterQuery` returns a `FilterQuery`, an AND of terms, and `serializeFilterQuery` and `buildFilterWhere` take one. The parser never throws, and `parseFilterQuery(serializeFilterQuery(query))` gives back the query it was handed. `isEmptyFilterToken` and `isFieldConditionToken` are exported so callers share the engine's rules for which tokens filter nothing and which map through a field.

```ts
import { parseFilterQuery, serializeFilterQuery } from '@opensaas/stack-core'

const query = parseFilterQuery('title:"Ada \\"the Countess\\"" "status:draft"')
// query.terms[0]: { kind: 'token', field: 'title', operator: 'eq', negated: false,
//                   values: ['Ada "the Countess"'], quoted: true }
// query.terms[1]: { kind: 'token', field: null, ..., values: ['status:draft'], quoted: true }
serializeFilterQuery(query) // 'title:"Ada \\"the Countess\\"" "status:draft"'
```

Two round-trip defects are fixed: an embedded quote is written as `\"` inside a quoted value, and a quoted `"status:draft"` stays a free-text word instead of coming back as a `status` filter.

Some existing `?search=` URLs now read differently:

- Inside a quoted value, `\"` is a literal quote and `\\` a literal backslash, so a quoted value containing either reads differently. A value the old serialiser wrote ending in a backslash, `name:"my dir\" beta`, no longer closes its quote.
- Every whitespace character, including a non-breaking space, separates tokens.
- A leading `-` followed by more of the token reads as negation, and commas separate a token's values. The engine searches a negated token as the literal word it was written as, and a token with several values as the comma-joined value, so `-beta` and `title:a,b` filter as they did. A quoted value followed by a comma, such as `title:"a b",c`, is now one token.

`serializeFilterQuery` now writes every term, so a token with an empty value is written as `field:` or `""` instead of being dropped. Remove empty tokens before serialising, with `isEmptyFilterToken`, when the result should not carry them. It also quotes a value containing a comma or any whitespace, and a free-text word starting with `-`.

`FilterBuilder` builds on core's parser and serialiser directly. Its props are unchanged. It keeps an unchanged query in the order it was written and never writes an empty row or empty token into the URL.
