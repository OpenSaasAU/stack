---
'@opensaas/stack-core': minor
---

Make `calendarDay` a `YYYY-MM-DD` string end-to-end (Keystone's CalendarDay scalar)

`calendarDay` is now a `YYYY-MM-DD` **string** at the `context.db` boundary in
both directions, so its type, validation, and runtime value finally agree.
Previously the field validated a `YYYY-MM-DD` string but its TypeScript type was
`Date`, so a typed caller passing `new Date(...)` hit a runtime `ValidationError`.

- The field/read type and the generated `CreateInput`/`UpdateInput` input types
  are now `string`.
- Writes accept only a `YYYY-MM-DD` string; a malformed string or a `Date` is
  rejected at runtime by validation (a `ValidationError`).
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
