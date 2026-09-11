---
'@opensaas/stack-ui': minor
---

Render `calendarDay()` fields in the admin UI

`calendarDay()` had no registered UI component, so a field declared with it
logged `No component registered for field type: calendarDay` and rendered
nothing in the item form. It now has both a form component and a list-table
cell, registered under `calendarDay` in the usual registries — no wiring
needed:

```typescript
// opensaas.config.ts
fields: {
  publishDate: calendarDay({ validation: { isRequired: false } }),
}
```

A calendar day names a day, not an instant, so the value read from and written
back to `context.db` is the same `YYYY-MM-DD` string core documents, resolved
through local-time components in both directions — the day shown is the day
stored, in any timezone.

Both components are exported for custom UIs, alongside the date-only
`DatePicker` primitive they are built on:

```typescript
import { CalendarDayField } from '@opensaas/stack-ui/fields'
import { DatePicker } from '@opensaas/stack-ui/primitives'
import { CalendarDayCell } from '@opensaas/stack-ui'
```
