---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Add Preset views to the admin list view

A list declares named starting points under `ui.listView.presets`. They show as tabs above the Filter builder, after an implicit "All" tab, with no counts. Each key must be non-empty and unique within the list (`config()` throws otherwise):

```ts
import { quoteFilterValue } from '@opensaas/stack-core'

ui: {
  listView: {
    presets: [
      {
        key: 'my-drafts',
        label: 'My drafts',
        search: ({ session }) => `status:draft author:#${session?.userId ?? ''}`,
        sort: { field: 'title', direction: 'asc' }, // optional
        hasAccess: ({ session }) => typeof session?.userId === 'string', // optional
      },
      {
        key: 'named-for-me',
        label: 'Named for me',
        search: ({ session }) => `title:${quoteFilterValue(session?.name ?? '')}`,
      },
    ],
  },
}
```

`search` is a `?search=` query or a function of the session, and is resolved on the server for every request. It runs through the same filter engine and secured context as a typed query, so a preset only narrows. `sort` goes through the same check as `?sort=`. Only each tab's `key` and `label` cross to the client.

`author:#<id>` matches exactly the session's own records. The new `quoteFilterValue(text)` export from `@opensaas/stack-core` quotes any other value built from data, so it always reads back as exactly one filter value.

`?preset=<key>` opens a preset, so a shared link resolves against the recipient's session. The first change to the filter, sort, columns or page size writes the preset out as `?search=` and `?sort=` and drops `?preset=`, leaving the rows on screen unchanged. An unknown key, or one whose `hasAccess` does not return `true`, shows the plain list. An open preset with no rows says so by its label rather than echoing its query.

`ListView` takes a new `preset` prop (`AdminUI` reads it from `?preset=`), and `ListViewClient` takes `presets` and `activePreset`. The tabs carry the `preset-tabs` and `preset-tab` slots.
