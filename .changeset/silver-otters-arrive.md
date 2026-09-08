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

Nothing needs configuring: a to-many whose back-reference owns a nullable foreign key becomes editable on the edit form automatically. A to-many with no writable edge — a list-only `ref`, a required foreign key (`db.isNullable: false` or `validation: { isRequired: true }`), or an edge across an explicit junction list — stays read-only with its reason.

On the **default** edit route a to-many renders as a relationship table rather than a multi-select, so that table's "Link existing" control — until now offered only for an edge across a junction list — now also links an existing related row by writing its own foreign key, under the related list's update access. Selecting a post on a user's edit page therefore updates that post's foreign key whether the field is left at its default display or demoted to `ui.itemView.displayMode: 'picker'`.

The edge writes commit before the record's own update and are not rolled back, so a record update that then fails reports the save as partial instead of as a plain failure.

Ids now cross the wire through one contract-driven coercion (ADR-0048), which reads each list's id type from the contract:

```typescript
import { parseListId } from '@opensaas/stack-core'

parseListId(config, 'Post', '12') // { ok: true, value: 12 } on an int-keyed list
parseListId(config, 'Post', 'not-an-int') // { ok: false }
parseListId(config, 'Post', '3000000000') // { ok: false } — outside the int4 column
```

Admin routing parses the URL's item id through it and **404s a malformed one**, so `/admin/post/not-an-int` on an integer-keyed list is a not-found rather than a query built on a `NaN`. The server actions parse their ids the same way.

Nav counts are read through the secured `aggregate` reducer, so a badge again reports the rows the session may see.
