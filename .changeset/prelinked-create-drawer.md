---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Add a pre-linked create drawer to read-only Relationship tables (issue #738)

The item view's read-only Relationship tables now offer a "+ Add" control that
opens a drawer hosting the related list's create form, with the back-reference to
the current record preset and hidden. On submit the new row is created through
the secured context already linked to the parent, then the drawer closes and the
table refreshes.

Create-and-link semantics (ADR-0018): the create runs on the RELATED list, so
the related list's own `create` access control, hooks, and field-level access
apply — never the parent's. The back-reference is set on the server from the
field/parent id (never trusted from the client payload). The "+ Add" is shown
only when a back-reference exists to preset the link and the related list's
`create` access is not statically denied; a filter/function-scoped denial
surfaces at commit time as a generic error (no denied-vs-absent leak).

New generic server action (`@opensaas/stack-core`):

```ts
await context.serverAction({
  listKey: 'Post', // the RELATED list
  action: 'createRelated',
  data: { title: 'Hello', slug: 'hello' },
  field: 'author', // the back-reference field on Post
  parentId: user.id, // the record being edited
})
// → { created: true, id } | { created: false, error?, fieldErrors? }
```

The drawer (`RelationshipCreateDrawer` from `@opensaas/stack-ui`) mounts on the
existing `relationship-table-toolbar` seam and reuses the shared item-form engine
and field-component registry, so the related list's full validation and required
fields are enforced even when a required field is not one of the table's columns.
