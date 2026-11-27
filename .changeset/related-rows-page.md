---
'@opensaas/stack-ui': minor
'@opensaas/stack-core': minor
'create-opensaas-app': patch
---

Relationship tables page in place, link only unlinked records, and can undo an unlink

A to-many table on the item page now pages through its rows: the footer reads
"Showing 11–20 of 42 rows" with Previous and Next, driven by a `<field>Page`
URL parameter, so each table keeps its own page. `ui.itemView.take` is the page size.

```typescript
posts: relationship({ ref: 'Post.author', many: true, ui: { itemView: { take: 20 } } })
```

"Link" now offers only records not already linked to this one. The
`relationshipOptions` server action takes `linkableFor`, the parent row's id,
and leaves out records already linked to that row, through a foreign key or a
junction list:

```typescript
await context.serverAction({
  listKey: 'Author',
  action: 'relationshipOptions',
  field: 'posts',
  linkableFor: authorId,
})
```

Each row's label cell links to the related record, so rows open from the
keyboard. Each ✕ is named for its row ("Unlink “Hello world”"). Unlinking shows
Undo, and the delete confirmation names the row it deletes.
