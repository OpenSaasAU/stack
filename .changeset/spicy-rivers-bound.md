---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Bound the admin item-view Relationship tables with a `take` and a "showing N of M" footer

The read-only Relationship tables on a record's edit page (issue #734) previously
fetched every related row unbounded. They now fetch a bounded page of related rows
and surface the full access-scoped total in the footer.

- **Bounded fetch:** each to-many Relationship table fetches at most a default cap
  of related rows (`DEFAULT_ITEM_VIEW_TAKE`, 10), overridable per relationship via
  `ui.itemView.take`. Rows are still fetched through the secured context, so only
  access-visible rows come back.
- **"Showing N of M" footer:** the totals footer now reads `Showing N of M rows`,
  where N is the rendered (bounded) count and M is the full access-scoped total,
  fetched via a filtered `_count` that folds the related list's own `query` access
  in (mirroring the list view's count columns). A fully-denied related list reads
  `Showing 0 of 0` and never leaks a true total. The row count is always shown,
  including the zero-column footer path.

```typescript
sessions: relationship({
  ref: 'Session.user',
  many: true,
  // Cap this table at 5 rows; the footer still shows the full access-scoped total.
  ui: { itemView: { take: 5 } },
})
```

Core: `mergeIncludeWithAccessControl` now preserves a caller-supplied `take` on a
to-many relation include (it only narrows the fetch, never widening past the access
`where`), so the secured `findUnique`/`findMany` include can bound related-row reads.
