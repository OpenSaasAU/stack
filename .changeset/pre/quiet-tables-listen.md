---
'@opensaas/stack-ui': minor
'create-opensaas-app': patch
---

Relationship tables and item-form relationship lookups read the Session vocabulary

What a Relationship table tells the browser about its related list now comes from that list's own Session vocabulary rather than from the admin evaluating access rules itself:

- A related column the session can never read is left out of the columns, field configs, rows, sums and editable columns the client receives.
- Inline cell edit is offered wherever the related list's vocabulary does not deny the write. A field update rule written as `item?.ownerId === session?.userId` is row-dependent, so owners can edit their own rows inline; the secured commit still decides each row.
- Remove, disconnect, create and link controls appear only where the related list's (or junction list's) operation is not denied. An operation rule returning `null` or `undefined` now hides them, as the engine denies it.
- Disconnect and the foreign-key link also need the back-reference field's own `update`; "+ Add" needs its `create`; a junction link needs `create` on both of the junction's foreign keys.
- A related list the session may not query renders as unavailable, with no columns, rows, count or write controls. A related list the context cannot resolve does the same instead of failing the page.
- A relationship column's labels, and an item form's relationship options, are looked up only when the session may query the related list.

```ts
// Task.status is inline-editable for the row's assignee
status: text({
  access: { update: ({ session, item }) => item?.assignee === session?.userId },
}),
```
