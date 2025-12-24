---
'@opensaas/stack-core': minor
---

Add `db.nativeType` and `db.isNullable` options to text field

You can now specify Prisma native database type attributes and control nullability independently:

```typescript
// Use PostgreSQL Text type instead of default String
fields: {
  description: text({
    validation: { isRequired: true },
    db: {
      nativeType: 'Text',
      isNullable: false,
    },
  }),
}
```

This generates:

```prisma
description String @db.Text
```

The `db.nativeType` option allows you to override the default Prisma type for your database provider (e.g., `Text`, `VarChar(255)`, `MediumText`), while `db.isNullable` lets you control nullability independently from the `isRequired` validation.
