---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Add Preset views to the admin list view

A list declares named starting points under `ui.listView.presets`. They show as tabs above the Filter builder, after an implicit "All" tab, with no counts. Each key must be unique within the list (`config()` throws on a duplicate):

```ts
ui: {
  listView: {
    presets: [
      {
        key: 'my-drafts',
        label: 'My drafts',
        search: ({ session }) => `status:draft author:${JSON.stringify(session?.name ?? '')}`,
        sort: { field: 'title', direction: 'asc' }, // optional
        hasAccess: ({ session }) => session !== null, // optional
      },
    ],
  },
}
```

`search` is a `?search=` query or a function of the session, and is resolved on the server for every request. It runs through the same filter engine and secured context as a typed query, so a preset only narrows. `sort` goes through the same check as `?sort=`. Only each tab's `key` and `label` cross to the client.

`?preset=<key>` opens a preset, so a shared link resolves against the recipient's session. The first change to the filter, sort, columns or page size writes the preset out as `?search=` and `?sort=` and drops `?preset=`, leaving the rows on screen unchanged. An unknown key, or one the session may not open, shows the plain list.

`ListView` takes a new `preset` prop (`AdminUI` reads it from `?preset=`), and `ListViewClient` takes `presets` and `activePreset`. The tabs carry the `preset-tabs` and `preset-tab` slots.
