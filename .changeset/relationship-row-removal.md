---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Add relationship-table row removal to the admin item view (ADR-0018)

Each read-only Relationship table row now has a ✕ removal control. By default it
**disconnects** the related row from the current record (non-destructive — the
row survives and still appears on its own list), gated on the related list's
update access. A per-relationship opt-in truly deletes the related row (behind a
confirmation, gated on the related list's delete access), or hides the control
entirely. Where the schema makes disconnect impossible (a required foreign key on
the related side) the control is hidden unless delete is opted in. Removals run
through the secured context, so an access-denied removal is a Silent failure: the
row stays with a visible reason.

Configure per relationship via `ui.itemView.removeAction`:

```typescript
User: list({
  fields: {
    // Default: ✕ disconnects the post (it still exists).
    posts: relationship({ ref: 'Post.author', many: true }),
    // Opt in to destructive delete (confirmed).
    notes: relationship({
      ref: 'Note.owner',
      many: true,
      ui: { itemView: { removeAction: 'delete' } }, // 'disconnect' (default) | 'delete' | 'none'
    }),
  },
})
```

`@opensaas/stack-core` adds a `removeRelated` server action (distinct
`{ removed }` result shape, like `bulkDelete`, so a redirect-on-success wrapper
never hijacks an in-place removal) and the `RelationshipItemViewConfig.removeAction`
option.
