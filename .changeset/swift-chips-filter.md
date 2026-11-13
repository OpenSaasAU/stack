---
'@opensaas/stack-ui': minor
'@opensaas/stack-core': minor
---

Replace the list view's Filter builder row form with a single filter bar

The Filter builder is now one bar where an admin types and suggestions build the
`?search=` query. Focusing it lists every filterable field; typing suggests
matching fields, config-enumerated values (`draft` offers "Status is Draft"),
plain phrases such as `views > 5000` or `status is draft`, and always a free-text
search. Choosing a field goes straight to its values, and Tab or a click switches
the condition. Each committed Filter token becomes a chip that can be edited by
clicking it, removed singly or cleared with the rest. Every commit applies at
once through `router.push` inside a transition, so the rows stay visible and Back
steps through changes; there is no Apply button, and partly typed text never
navigates. `/` focuses the bar, the arrows and Backspace select and remove chips,
and Esc cancels. The bar is a labelled combobox using `aria-activedescendant`.

`FilterBuilder` keeps its `suggestions`, `defaultValue` and `onApply` props, and
gains optional `label` and `resultCount`:

```tsx
<FilterBuilder
  suggestions={suggestions}
  defaultValue={search}
  onApply={(query) => router.push(`?search=${encodeURIComponent(query)}`)}
  label="Filter posts"
  resultCount={total}
/>
```

`filter-builder` stays the root `data-slot`. Removed slots: `filter-builder-conditions`,
`filter-builder-condition`, `filter-builder-field`, `filter-builder-operator`,
`filter-builder-value`, `filter-builder-remove`, `filter-builder-form`,
`filter-builder-search`, `filter-builder-search-clear`, `filter-builder-add` and
`filter-builder-apply`, with their `classNames` keys (`conditions`, `condition`,
`field`, `operator`, `value`, `remove`, `form`, `search`, `add`, `apply`). Added
slots: `filter-builder-bar`, `filter-builder-chip`, `filter-builder-chip-field`,
`filter-builder-chip-condition`, `filter-builder-chip-value`,
`filter-builder-chip-remove`, `filter-builder-draft`, `filter-builder-input`,
`filter-builder-progress`, `filter-builder-menu`, `filter-builder-menu-conditions`,
`filter-builder-menu-condition`, `filter-builder-option` and `filter-builder-hint`,
with `classNames` keys `bar`, `chip`, `chipRemove`, `draft`, `input`, `menu`,
`option` and `hint`. `filter-builder-clear` remains. `PopoverAnchor` is now
exported from the primitives.

A Filter spec can state the shape a typed value must take, so the builder
explains a value that does not fit instead of applying it as free text. The
built-in numeric, date and to-many relationship fields declare one:

```ts
getFilterSpec: (fieldName) => ({
  operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
  toCondition: (operator, value) => /* … */,
  suggestions: {
    valueSource: { kind: 'none' },
    valueFormat: { pattern: '^-?\\d+$', description: 'takes a whole number' },
  },
})
```

`collectFilterSuggestions` passes it on as `FilterFieldSuggestion.valueFormat`,
and `FilterValueFormat` is exported from the root and `/extend` entry points.

Each built-in field's `toCondition` tests the same `RegExp` its `valueFormat`
declares, so the hint and the engine agree, and `valueFormat.operators` gives an
operator its own pattern (`FilterValuePattern`, exported beside
`FilterValueFormat`). A to-many relationship declares `eq` and `gt` with `0` and
`gte` with `1`. A calendar day naming a month or day that does not exist
(`2026-13-01`, `2026-02-31`) degrades to free text instead of reaching Postgres.
A timestamp still takes anything `Date` parses and declares no `valueFormat`.
