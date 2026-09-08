---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Adding an edge across a junction is a create of the junction row, under that list's own create access

A many-to-many is an explicit junction list (ADR-0048), so an edge is one of its rows and adding one is a create — never a nested write on either parent. `context.serverAction({ listKey, action: 'addRelated', field, parentId, targetId })` names the **parent** list and its to-many field; the junction list, its back-reference and its far-endpoint field are resolved from the config on the server, so a caller can neither name a junction list of its own choosing nor set a column of the edge row beyond the two endpoints.

```ts
// Post.tags: relationship({ ref: 'PostTag.post', many: true })
// PostTag  : { post: relationship({ ref: 'Post.tags' }), tag: relationship({ ref: 'Tag.posts' }) }
await context.serverAction({
  listKey: 'Post',
  action: 'addRelated',
  field: 'tags',
  parentId: post.id,
  targetId: tag.id,
})
// → { added: true, id } — a PostTag row, gated on PostTag's own create access
```

The create is evaluated against the junction list, so a caller denied `create` there cannot add the edge and the denial is the usual silent one: `{ added: false }` with a generic reason, nothing written, nothing raised. Both endpoints go through `connect`, so an endpoint the caller cannot read is indistinguishable from one that does not exist.

`resolveJunctionEdge(config, parentListKey, fieldName)` is exported for callers that need the same answer. It returns `null` — leaving the ordinary to-many treatment in place — for a list-only `ref`, a junction with a third foreign key or none, and a junction carrying a required field of its own.

In the admin UI, a to-many section that is such an edge gains a **"Link"** control beside "+ Add", offered only when the junction list's own `create` access is not statically denied. The item form's to-many picker stays read-only — an edge can never ride in the parent's write payload — but its stated reason now points at that table rather than at another list's edit page.
