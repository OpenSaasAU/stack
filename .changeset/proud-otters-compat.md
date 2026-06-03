---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add opt-in `db.keystoneCompat` mode for Keystone-compatible empty-string text defaults

When migrating from Keystone 6, every non-null text column carries an implicit empty-string default. Set `db: { keystoneCompat: true }` to mirror that: any non-null `text()` column without an explicit `defaultValue` now generates `String @default("")`, so a migrating schema reaches parity without hand-setting `defaultValue: ''` on dozens of columns.

The mode is off by default (greenfield schemas stay clean) and never affects nullable text, fields with an explicit `defaultValue`, or any non-text field — an explicit `text({ defaultValue: 'x' })` always wins.

```typescript
export default config({
  db: {
    provider: 'postgresql',
    keystoneCompat: true, // non-null text without a default → @default("")
    prismaClientConstructor: (PrismaClient) => {
      // ... adapter setup
    },
  },
  lists: {
    Account: list({
      fields: {
        // required text → String @default("")
        name: text({ validation: { isRequired: true } }),
        // explicit default still wins → String @default("PLEASE_UPDATE")
        status: text({ validation: { isRequired: true }, defaultValue: 'PLEASE_UPDATE' }),
        // nullable text is untouched → String?
        bio: text(),
      },
    }),
  },
})
```

See ADR-0004 for the full Keystone-compatible generator defaults.
