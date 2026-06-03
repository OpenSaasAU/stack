---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Honour `defaultValue` for `text()`, `integer()`, and `json()` fields in the generated Prisma schema

These three field builders previously dropped `defaultValue` and emitted no `@default(...)`. They now serialise the configured default into a Prisma `@default(...)` literal via a new shared, pure `formatPrismaDefault` module, matching Keystone 6 conventions. The nullable `?` modifier is preserved independently of the default, and fields without a `defaultValue` still emit no `@default(...)`.

```typescript
fields: {
  // Int @default(3550)
  quota: integer({ defaultValue: 3550 }),
  // String @default("PLEASE_UPDATE")
  status: text({ defaultValue: 'PLEASE_UPDATE' }),
  // Json? @default("[1,2,3,4,5]") — Keystone's space-free JSON literal
  limits: json({ defaultValue: [1, 2, 3, 4, 5] }),
  // Json? @default("[]")
  tags: json({ defaultValue: [] }),
}
```

See ADR-0004 for the Keystone-compatibility rationale.
