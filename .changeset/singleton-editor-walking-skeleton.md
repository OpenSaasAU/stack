---
'@opensaas/stack-ui': minor
---

Render a single-record editor for `isSingleton` lists in `AdminUI`

A list configured with `isSingleton: true` now renders a single-record editor at
its bare `[list]` route instead of a list table. The new `SingletonView`
component resolves the record via the singleton `get()` operation (which
auto-creates the row with field defaults when absent) and reuses the existing
`ItemFormClient` in edit mode, so field rendering, validation, and the existing
`serverAction` save path all apply unchanged. Non-singleton lists are
unaffected and still render the table.

```typescript
// opensaas.config.ts
lists: {
  SiteSettings: list({
    isSingleton: true,
    fields: {
      siteName: text(),
      supportEmail: text(),
    },
  }),
}
```

Visiting `/admin/site-settings` now shows an "Edit Site Settings" form for the
single record rather than a one-row list.
