---
'@opensaas/stack-ui': minor
'@opensaas/stack-core': minor
---

Derive the admin item view from the list shape, with read-only Relationship tables and a totals footer (#734)

A record's edit page now derives its layout from the list's shape. Scalar and
to-one fields stay in a details card (whole-form Save/Cancel, unchanged), and
each to-many relationship renders as a read-only **Relationship table**: one
to-many relationship gives a two-column split, none gives a single centered
card, several stack. Table columns default to the related list's own column
curation minus the back-reference to the parent, cells come from the cell
registry, and a totals footer always shows the row count plus sums for any
explicitly-configured numeric columns (each formatted by that column's Cell).
Rows are fetched through the secured context, so only access-visible data shows.
Rows are read-only here — a row click navigates to the related record.

`@opensaas/stack-core` gains additive item-view config (no breaking changes):

```typescript
lists: {
  User: list({
    fields: {
      posts: relationship({
        ref: 'Post.author',
        many: true,
        ui: {
          itemView: {
            // Override the Relationship table's columns…
            columns: ['title', 'status', 'viewCount'],
            // …and sum numeric columns in the totals footer.
            sum: ['viewCount'],
            // Or demote it back to the compact picker in the details card:
            // displayMode: 'picker',
          },
        },
      }),
    },
    // Reorder the Relationship-table sections:
    ui: { itemView: { order: ['posts'] } },
  }),
}
```

New `@opensaas/stack-ui` exports: `RelationshipTable`, `RelationshipTableClient`,
and the pure `deriveItemViewLayout` helper (with `ItemViewLayout`,
`ItemViewArrangement`, `RelationshipTableSection`). The Relationship table ships
named Slots (`relationship-table`, `relationship-table-toolbar`,
`relationship-table-row`, `relationship-table-cell`, `relationship-table-footer`)
as extension seams for the follow-up inline-edit, create-drawer, and row-removal
work.
