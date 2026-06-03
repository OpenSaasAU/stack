---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add `select()` db options for Keystone schema parity: `db.isNullable` and `db.enumName`.

`db.isNullable: true` forces the nullable `?` on the generated column even when a
`defaultValue` is present. The default behaviour is unchanged — a select with a
`defaultValue` still generates NOT NULL unless you opt in explicitly:

```typescript
// Optional select with a default, kept nullable for data containing NULLs
status: select({
  options: [
    { label: 'Draft', value: 'draft' },
    { label: 'Published', value: 'published' },
  ],
  defaultValue: 'draft',
  db: { isNullable: true },
})
// Generates: status String? @default("draft")

// Enum-backed equivalent
status: select({
  options: [{ label: 'Open', value: 'open' }],
  defaultValue: 'open',
  db: { type: 'enum', isNullable: true },
})
// Generates: status <Enum>? @default(open)
```

`db.enumName` overrides the derived `<List><Field>` name of the generated Prisma
enum for native-enum selects, renaming both the `enum` block and every reference
to it in the owning model — useful for matching a live DB enum (e.g. Keystone's
`…Type` suffix):

```typescript
status: select({
  options: [
    { label: 'Open', value: 'open' },
    { label: 'Closed', value: 'closed' },
  ],
  db: { type: 'enum', enumName: 'AccountNoteStatusType' },
})
// Generates: enum AccountNoteStatusType { ... } and the column references it
```
