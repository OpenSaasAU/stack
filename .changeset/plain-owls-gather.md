---
'@opensaas/stack-ui': minor
---

The admin list view reads through the secured surface, and its total is an `aggregate`

The list table now composes one secured read instead of calling `findMany`/`count`: the filter engine's Where vocabulary value goes to `.where()`, a to-one relationship is an `.include()` and a to-many displayed as a count column is the native count reducer, and the header's total is `.aggregate((a) => ({ total: a.count() }))` over the same scoped read — so the number above the table always equals the number of rows the session may page through.

Sorting by a to-many relationship count is gone with the `_count` include that powered it: `orderBy` takes the list's own scalar columns, so a `?sort=` naming a relationship is ignored exactly the way a read-denied field's sort already was, and the count column's header no longer offers a sort affordance it cannot honour. The count itself still displays through the reducer.

```
?search=orders:0     → orders: { none: {} }
?search=orders:>0    → orders: { some: {} }
?search=orders:>5    → falls back to free text, rather than erroring
?search=name:ada     → matches "Ada" (text eq/contains are case-insensitive)
```

A count comparison the vocabulary cannot express no longer errors: the token falls back to free text, so `orders:>5` searches the list's free-text fields for `5` — and on a list with no free-text field the token is dropped altogether, leaving the read unfiltered by it.

The URL grammar is unchanged, so a bookmarked filter keeps parsing identically.
