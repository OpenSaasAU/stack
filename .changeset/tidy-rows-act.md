---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Add Row actions to the admin list view

Each row now has a menu with the built-in Edit, Copy link and Delete (confirmed through `ConfirmDialog`), and the row title links to the item page. The previous per-row Edit link moves into that menu. A list declares its own actions under `ui.listView.rowActions`:

```ts
ui: {
  listView: {
    rowActions: [
      {
        key: 'publish',
        label: 'Publish now',
        icon: 'send',
        hasAccess: ({ session }) => session !== null,
        isAvailable: ({ item }) => item.status !== 'published',
        handler: async ({ id, context }) => {
          const post = await context.db.Post.update({ where: { id }, data: { status: 'published' } })
          return { message: post ? 'Published' : 'Not published' }
        },
      },
    ],
  },
}
```

`hasAccess` is resolved once per request and the synchronous `isAvailable` per row on the server, over a read in the same shape dispatch re-reads the row in; only the available keys reach the client, and handlers never do. Running one dispatches the new `serverAction` operation `{ action: 'rowAction', key, id }`, which re-reads the row through the secured context and re-runs both checks before the handler runs. The handler's `id` is the list's own id type (`RowActionContext<TypeInfo>['id']`, a `number` on an `int autoincrement` list). A missing, denied or no-longer-eligible row, or a `hasAccess` or `isAvailable` that throws, answers `{ rowAction: false, error: 'This action was not run' }` alike. Outcomes appear in the list's status line.

`@opensaas/stack-ui/primitives` gains a `DropdownMenu` primitive on the existing Radix dependency, with `dropdown-menu-*` slots. The list view adds the `row-actions-trigger` and `row-title-link` slots.
