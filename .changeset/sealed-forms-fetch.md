---
'@opensaas/stack-ui': minor
'create-opensaas-app': patch
---

`serializeItemForForm` takes the record's id and reads the row itself

`serializeItemForForm(context, listKey, id, purpose?)` on `@opensaas/stack-ui/server` now reads the row through the session's own secured surface, so Field Visibility applies every `read` rule, one that depends on the row included. It no longer takes a row, so a row from `context.unsafe`, a `sudo()` read or a hand-built object cannot reach a `'use client'` form: passing one is a compile error.

The id is parsed against the list's `db.idField`, as an admin URL segment is, so a string route param works for an `int autoincrement` list. The result is `null` when the session may not read the row, when no row has that id, and when the id is not one the list's key type can hold. A to-one relationship comes back as its related id. A to-many relationship is not prefilled. On a singleton list the row is read through `get()` and never auto-created, so a singleton with no stored row answers `null`. The access that applies is that of the context you pass: `context.sudo()` reads as sudo.

Migration:

```tsx
// Before
const post = await context.db.Post.where({ id: { equals: params.id } }).first()
if (post === null) notFound()
const initialData = await serializeItemForForm(context, 'Post', {
  id: post.id,
  title: post.title,
  status: post.status,
})

// After
const initialData = await serializeItemForForm(context, 'Post', params.id)
if (initialData === null) notFound()
```
