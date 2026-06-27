---
'@opensaas/stack-cli': minor
---

Enforce field-level scalar narrowing at the write call site, and fix `checkbox({ defaultValue: false })` optionality

The generated `context.db.<list>.create()/update()/createMany()/updateMany()` `data`
type now narrows scalar fields to their OpenSaaS `getTypeScriptType()` types instead of
inheriting Prisma's wider input types. Field-level narrowing (e.g. `calendarDay` → `string`)
is now a genuine compile-time error to violate, not just a runtime validation failure.

```ts
// calendarDay is a `string` end-to-end:
await context.db.event.create({ data: { startDate: new Date() } })
//                                                  ^^^^^^^^^^ Type 'Date' is not assignable to type 'string'.
await context.db.event.create({ data: { startDate: '2026-01-01' } }) // ✅ compiles
```

Relationship nested writes (`connect`/`create`/`connectOrCreate`), unchecked foreign keys
(e.g. `authorId`), and `decimal`/`json` writes are unaffected: `decimal` still accepts
`Decimal | number | string` and `json` still accepts Prisma's `JsonNull`/`DbNull` sentinels.

Also fixes a latent bug where `checkbox({ defaultValue: false })` (and any field with a
falsy-but-present default) was generated as a required field on create — it is now correctly
optional.

Note: this may surface pre-existing type errors in consumer code that passed a `Date` to a
`calendarDay` field. Such code already failed at runtime; it now fails at compile time. Pass a
`YYYY-MM-DD` string instead.
