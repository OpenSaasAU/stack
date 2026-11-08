---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

The list filter grammar and the Filter builder gain OR groups (ADR-0083)

`?search=` reads `(a OR b)` as an OR group: rows matching any of its tokens, ANDed with the rest of the query and, as always, with the access filter. Groups do not nest.

```
(status:draft OR author:#0190a3c2-…) views:>100
(views:1..5 OR title:"Ada (Countess)")
```

**What changes meaning.** Only a matched group: `(` directly before the first token, uppercase `OR` between tokens, and `)` directly after the last. Everything else keeps the meaning it had: `a OR b` without parentheses, a lowercase `(a or b)`, a quoted `"OR"`, `(a)`, `-(a OR b)`, unmatched parentheses and nested groups are still free-text words. A URL that already held a matched `(a OR b)` used to search for three words, and now matches either side.

Each token in a group maps exactly as it would on its own, negation included. A token in a group that cannot map — an unknown field, one the session cannot read, a value the field rejects — stays in place as its free-text alternative and is never dropped; a negated one searches its literal word and is never negated.

Core: `FilterTerm` is now `FilterToken | FilterGroup` (`{ kind: 'group', tokens }`), and `filterTermTokens`, `filterQueryTokens` and `FILTER_GROUP_KEYWORD` are exported. Code that read `parseFilterQuery(q).terms` as tokens flattens them:

```ts
import { filterQueryTokens, parseFilterQuery } from '@opensaas/stack-core'

for (const token of filterQueryTokens(parseFilterQuery(search))) {
  // every token, inside groups too
}
```

UI: chips are joined by **and** / **or** connector buttons. Clicking an **and** joins two chips into a group, drawn as one bordered unit; clicking an **or** splits it. Typing `or ` after a filter adds an alternative to it, and typing `draft or priya` builds the whole group. A group left with one member stops being a group, and the "a second `is` replaces the first" rule applies outside groups only. New `data-slot`s: `filter-builder-group`, `filter-builder-connector` and `filter-builder-alternative`, with matching `group` and `connector` entries in `FilterBuilderClassNames`.
