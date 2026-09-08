---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

The item form writes to-many edges against the related list, and admin routing parses ids through the contract

A to-many relationship's foreign key lives on the related row, so it can never ride in the record's own update payload — and connecting through an inverse field no longer compiles. The item form's multi-select now writes each edge as a write against the **related list**, under that list's own access control: adding one sets the related row's foreign key, removing one clears it. A denied write reverts the control to what the database actually holds and shows the reason, instead of navigating away on a save that never landed.

The related-row writes go through two server actions, both keyed on the related list:

```typescript
// Link an existing related row to the parent (new)
await serverAction({
  listKey: 'Post',
  action: 'linkRelated',
  id: postId,
  field: 'author',
  parentId: userId,
})

// Unlink it again (unchanged)
await serverAction({
  listKey: 'Post',
  action: 'removeRelated',
  mode: 'disconnect',
  id: postId,
  field: 'author',
})
```

Nothing needs configuring: a to-many whose back-reference owns a nullable foreign key becomes editable on the edit form automatically. A to-many with no writable edge — a list-only `ref`, a required foreign key, or an edge across an explicit junction list — stays read-only with its reason, and a junction's links are still added and removed from the relationship table.

Ids now cross the wire through one contract-driven coercion (ADR-0048), which reads each list's id type from the contract:

```typescript
import { parseListId } from '@opensaas/stack-core'

parseListId(config, 'Post', '12') // { ok: true, value: 12 } on an int-keyed list
parseListId(config, 'Post', 'not-an-int') // { ok: false }
```

Admin routing parses the URL's item id through it and **404s a malformed one**, so `/admin/post/not-an-int` on an integer-keyed list is a not-found rather than a query built on a `NaN`. The server actions parse their ids the same way.

Nav counts are read through the secured `aggregate` reducer, so a badge again reports the rows the session may see.
