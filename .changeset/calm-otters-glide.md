---
'@opensaas/stack-core': minor
---

Make `calendarDay` a `YYYY-MM-DD` string end-to-end (Keystone's CalendarDay scalar)

`calendarDay` is now a `YYYY-MM-DD` **string** at the `context.db` boundary in
both directions, so its type, validation, and runtime value finally agree.
Previously the field validated a `YYYY-MM-DD` string but its TypeScript type was
`Date`, so a typed caller passing `new Date(...)` hit a runtime `ValidationError`.

- The field type (entity, `CreateInput`, `UpdateInput`) is now `string`, so
  passing a `Date` is a compile error.
- Writes still accept only a `YYYY-MM-DD` string (malformed strings are rejected
  with a clear message).
- Storage is unchanged: `DateTime @db.Date` on Postgres/MySQL, the SQLite TEXT
  fallback as before.

**Behavioral change (reads):** reading a `calendarDay` now returns a
`YYYY-MM-DD` string instead of a `Date`. A field `resolveOutput` transform
normalises the value Prisma returns from the `@db.Date` column, using UTC
components to avoid timezone off-by-one. Consumers that previously relied on a
`Date` on read should update to the string form:

```typescript
const event = await context.db.event.findUnique({ where: { id } })
event?.startDate // => '2025-01-15' (string, not Date)

// Writes: pass YYYY-MM-DD strings, not Date objects
await context.db.event.create({ data: { startDate: '2025-01-15' } })
```
