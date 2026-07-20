# Custom Bulk Actions

The admin list view lets an admin select rows with checkboxes and act on the
whole selection at once. Delete is the only built-in Bulk action; every other
action is **list-specific** and declared in that list's config. This guide shows
how to add a custom Bulk action and documents a CSV-export recipe built on the
same surface.

## How it works

You declare Bulk actions under `ui.listView.bulkActions`. Each action has a
stable `key`, a `label`, an optional button `variant`, and a server-side
`handler` that receives the **selected ids** and the **secured context**:

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, select } from '@opensaas/stack-core/fields'

export default config({
  // ...
  lists: {
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          defaultValue: 'draft',
        }),
      },
      ui: {
        listView: {
          bulkActions: [
            {
              key: 'publish',
              label: 'Publish',
              handler: async ({ ids, context }) => {
                let published = 0
                for (const id of ids) {
                  const updated = await context.db.post.update({
                    where: { id },
                    data: { status: 'published' },
                  })
                  // Access-denied rows return null (Silent failure) — not counted.
                  if (updated) published++
                }
                return { message: `Published ${published} of ${ids.length}` }
              },
            },
          ],
        },
      },
    }),
  },
})
```

The action's button appears in the selection bar, in declaration order,
alongside the built-in Delete. When it completes, its returned `message` shows in
the selection bar's status line, the selection clears, and the table refreshes.

## The secured-context / serialisation boundary

Two rules keep custom actions safe:

1. **The `handler` runs entirely server-side and must do all its work through
   `context.db`** — never a raw Prisma client. Each id therefore goes through the
   list's access control and hooks, exactly like any other write. A row the
   session may not touch returns `null` (Silent failure); count it out of your
   result rather than surfacing which ids were denied. Never leak _which_ rows
   failed.
2. **The `handler` never crosses to the client.** Only the serialisable
   metadata — `key`, `label`, `variant`, `destructive` — is sent to the browser.
   Clicking the button sends the `key` and the selected ids back through the
   admin's server action, which looks the handler up by `key` and runs it with a
   freshly-rebuilt secured context.

## Options

- **`variant`** — the button style (`'default'`, `'destructive'`, `'outline'`,
  `'secondary'`, `'ghost'`, `'link'`). Defaults to `'outline'`.
- **`destructive`** — when `true`, the admin must confirm in a dialog before the
  action runs (the same affordance as the built-in Delete).
- **`hasAccess`** — an optional server-side gate, `({ session, context, listKey })
=> boolean | Promise<boolean>`. Return `false` to hide the button from sessions
  that may not perform it. It is re-checked on dispatch, so hiding a button is a
  UX affordance — the real boundary is your `handler` running through the secured
  context.

```typescript
bulkActions: [
  {
    key: 'suspend',
    label: 'Suspend',
    variant: 'destructive',
    destructive: true,
    // Only show to admins.
    hasAccess: ({ session }) => session?.role === 'admin',
    handler: async ({ ids, context }) => {
      let n = 0
      for (const id of ids) {
        const updated = await context.db.user.update({
          where: { id },
          data: { suspended: true },
        })
        if (updated) n++
      }
      return { message: `Suspended ${n} of ${ids.length}` }
    },
  },
]
```

## Recipe: CSV export

CSV export is **not** a built-in — it is a custom Bulk action. Read the selected
rows through the secured context (so an admin only ever exports rows they may
see), build the CSV, and hand the result back. Because the action reports a
status message rather than streaming a file, persist the CSV somewhere the admin
can retrieve it (for example your storage provider) and return the location in
the message:

```typescript
bulkActions: [
  {
    key: 'export-csv',
    label: 'Export CSV',
    handler: async ({ ids, context }) => {
      // Read only the selected rows, access-scoped.
      const rows = await context.db.post.findMany({
        where: { id: { in: ids } },
      })

      // Build CSV (escape values as needed for your data).
      const header = ['id', 'title', 'status']
      const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
      const csv = [
        header.join(','),
        ...rows.map((r) => [r.id, r.title, r.status].map(escape).join(',')),
      ].join('\n')

      // Persist it and return a retrievable location. For example, upload to
      // your configured storage provider and return the URL:
      //   const { url } = await uploadExport(context, csv)
      //   return { message: `Exported ${rows.length} rows — ${url}` }

      return { message: `Exported ${rows.length} rows` }
    },
  },
]
```

The same pattern generalises to any batch operation — re-index, send a
notification, enqueue a job — as long as the work runs through `context.db` (or
another access-checked service) and reports a non-leaking summary.
