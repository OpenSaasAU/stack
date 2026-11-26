---
'@opensaas/stack-ui': minor
'create-opensaas-app': patch
---

A Preset view's plain dates on timestamp fields now mean the viewer's local day

The admin records the browser's time zone in an `opensaas-tz` cookie, and `ListView` reads a preset's plain `YYYY-MM-DD` days on timestamp fields as that day in the zone, so "Published today" is today wherever the admin is:

```ts
presets: [{ key: 'launch-day', label: 'Launch day', search: 'publishedAt:2026-08-04' }]
```

Opened in Sydney, this covers 4 August from 00:00 to 23:59 Sydney time instead of the UTC day. A plain date typed into a URL stays the UTC day. A host that knows the zone another way can pass it:

```tsx
<ListView
  context={context}
  config={config}
  listKey="Post"
  preset="launch-day"
  timeZone="Australia/Sydney"
/>
```
