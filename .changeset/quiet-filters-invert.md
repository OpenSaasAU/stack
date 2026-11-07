---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Core owns one structured filter query, with a parser and serialiser that are true inverses (ADR-0083)

`parseFilterQuery` now returns a `FilterQuery` — an AND of terms — and `serializeFilterQuery` and `buildFilterWhere` take one. A term is a `FilterToken`, which now carries `kind`, `negated`, `values` and `quoted` in place of `value` and `raw`. The parser never throws, and `parseFilterQuery(serializeFilterQuery(query))` gives back the query it was handed.

```ts
import { parseFilterQuery, serializeFilterQuery } from '@opensaas/stack-core'

const query = parseFilterQuery('title:"Ada \\"the Countess\\"" "status:draft"')
// query.terms[0]: { kind: 'token', field: 'title', operator: 'eq', negated: false,
//                   values: ['Ada "the Countess"'], quoted: true }
// query.terms[1]: { kind: 'token', field: null, ..., values: ['status:draft'], quoted: true }
serializeFilterQuery(query) // 'title:"Ada \\"the Countess\\"" "status:draft"'
```

Two round-trip defects are fixed: an embedded quote is written as `\"` inside a quoted value, and a quoted `"status:draft"` stays a free-text word instead of coming back as a `status` filter. Every other existing `?search=` URL means what it meant.

`@opensaas/stack-ui` removes `queryToState`, `stateToQuery`, `FilterRow` and `FilterBuilderState`. `FilterBuilder` now builds on core's parser and serialiser directly; its props and behaviour are unchanged.
