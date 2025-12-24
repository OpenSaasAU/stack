---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add calendarDay field type for date-only values in ISO8601 format

You can now use the `calendarDay` field for storing date values without time components:

```typescript
import { calendarDay } from '@opensaas/stack-core/fields'

fields: {
  birthDate: calendarDay({
    validation: { isRequired: true }
  }),
  startDate: calendarDay({
    defaultValue: '2025-01-01',
    db: { map: 'start_date' }
  }),
  eventDate: calendarDay({
    isIndexed: true
  })
}
```

The field:

- Stores dates in ISO8601 format (YYYY-MM-DD)
- Uses native DATE type on PostgreSQL/MySQL via `@db.Date`
- Uses string representation on SQLite
- Supports all standard field options (validation, database mapping, indexing)
