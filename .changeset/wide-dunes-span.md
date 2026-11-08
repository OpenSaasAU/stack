---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Filter numbers and dates by range, with date presets that follow the admin's time zone

`field:a..b` is an inclusive range in one token. `parseFilterQuery` reads it as a token with `operator: 'range'` and the two bounds as its `values`, and `serializeFilterQuery` writes it back unchanged. Any field whose Filter spec accepts both `gte` and `lte` takes a range with nothing more to declare: the engine lowers each bound through the field's own `toCondition`, and a range with a bound the field does not take degrades to free text. On a field that takes no range, `field:a..b` keeps its old meaning, that field's `eq` on the literal `a..b`, so `title:wait...what` still means "title contains wait...what".

```
views:1000..5000
publishedAt:2026-11-02T00:00:00.000+11:00..2026-11-08T23:59:59.999+11:00
```

In a URL, encode the `+` of an offset as `%2B`: `?search=publishedAt:2026-11-02T00:00:00.000%2B11:00..2026-11-08T23:59:59.999%2B11:00`.

`FilterToken.operator` is now a `FilterTokenOperator` (`FilterOperator | 'range'`), and core exports `supportsFilterRange`, `filterTokenOperators` and `effectiveFilterToken`. A Filter spec may state `suggestions.datePicker` (`'day'` or `'instant'`) to get date inputs and presets in the Filter builder; `calendarDay()` declares `'day'` and `timestamp()` declares `'instant'`:

```ts
getFilterSpec: (fieldName) => ({
  operators: ['gte', 'lte'],
  toCondition: (operator, value) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : { [fieldName]: { [operator]: date } }
  },
  suggestions: { valueSource: { kind: 'none' }, datePicker: 'instant' },
})
```

The Filter builder offers a "between" condition, typed as `1000-5000`, `1000 to 5000` or `1000..5000`, or picked with date inputs. Date fields add presets (Today, Last 7 days, Last 30 days, This month, Last month, This year) that write absolute dates, shown on the chip. A timestamp is written as ISO instants in the browser's offset with the end day inclusive, whether its dates are picked, typed or pasted; a calendar day stays plain `YYYY-MM-DD`. On a field with date inputs, Tab moves into them and Alt+← → switches the condition. Pasted `>=` and `<=` tokens on one field read back as one chip while the URL keeps both tokens. `FilterBuilder` gains a `dates` slot (`filter-builder-dates`).
