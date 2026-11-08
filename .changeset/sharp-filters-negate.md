---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

The list filter grammar gains "is not", "is any of" and "is empty" (ADR-0083)

`?search=` now reads a leading `-` as negation, a comma list as several values and `field:!` as "is empty":

```
-category:product        # is not product, rows with no category included
status:draft,review      # is any of
author:!  -author:!      # is empty / is not empty
```

The engine composes `NOT` and `OR` around each field's existing `toCondition`, so a third-party field gets negation and any-of with no changes. To offer "is empty", a Filter spec states what empty means with the new optional `empty` member:

```ts
getFilterSpec: (fieldName) => ({
  operators: ['eq'],
  toCondition: (operator, value) => (operator === 'eq' ? { [fieldName]: { equals: value } } : null),
  empty: { [fieldName]: { equals: null } },
  suggestions: { valueSource: { kind: 'none' } },
})
```

Every core field that can be empty sets it, and `collectFilterSuggestions` reports it as `canBeEmpty: true`. A negated token is ORed with the field's `empty` condition, so "is not" keeps the rows with no value, unless the spec's new optional `negation` says `NOT` alone already does (`'includesEmpty'`, as on a to-one relationship) or only restates another condition (`'redundant'`, as on a to-many count, where the builder then offers no "is not"). A token that cannot map in any part is searched as one free-text word, the new `filterTokenFreeTextWord(token)`, which is also what its chip shows. A positive token searches its values with the field name dropped (`status:draft,bogus` searches `draft,bogus`); a negated one searches its whole literal and is never negated (`-secret:x` on a field the session cannot read searches `-secret:x`).

`FilterToken` now carries its quoting per value — `values: Array<{ text, quoted }>` replaces `values: string[]` and the token-level `quoted` — and its `operator` is a `FilterTokenOperator` (`FilterOperator | 'empty'`). `isFieldConditionToken` takes a lookup returning `{ operators, canBeEmpty }`, so a `FilterFieldSuggestion` can be passed straight in. The comparison prefixes are exported once as `FILTER_OPERATOR_PREFIXES` and `FILTER_COMPARISON_PREFIXES`.

The Filter builder offers "is not" / "does not contain", "is any of" (a multi-select list building one chip) and "is empty" / "is not empty" where the field can be empty, reads phrases such as `status is not draft`, `views != 3` and `author is empty`, and hydrates each shape from the URL as a chip. It adds the `filter-builder-option-check` slot, and an "is empty" chip renders no `filter-builder-chip-value` part.
