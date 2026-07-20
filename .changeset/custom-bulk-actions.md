---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Add custom Bulk actions from list config (admin list view)

A list can now declare list-specific Bulk actions under `ui.listView.bulkActions`. Each action's button renders in the list view's selection bar (in declaration order) alongside the built-in Delete. The action's server-side `handler` receives the selected ids and the secured context, so all its work runs through access control and hooks — a denied row is a Silent failure absorbed into the outcome, never leaked.

```typescript
Post: list({
  fields: { title: text(), status: select({ options: [/* ... */] }) },
  ui: {
    listView: {
      bulkActions: [
        {
          key: 'publish',
          label: 'Publish',
          // Optional: `variant`, `destructive` (confirm first),
          // `hasAccess` (server-side visibility gate).
          handler: async ({ ids, context }) => {
            let n = 0
            for (const id of ids) {
              const updated = await context.db.post.update({
                where: { id },
                data: { status: 'published' },
              })
              if (updated) n++
            }
            return { message: `Published ${n} of ${ids.length}` }
          },
        },
      ],
    },
  },
})
```

Only serialisable metadata (`key`/`label`/`variant`/`destructive`) crosses to the client; the `handler`/`hasAccess` functions stay on the server. Clicking the button sends the `key` and selected ids back through the generic server action, which looks the handler up and runs it with a freshly-rebuilt secured context. Selection is enabled for a list that has custom actions even when Delete is denied. CSV export is documented as a recipe using this surface rather than shipping as a built-in.
