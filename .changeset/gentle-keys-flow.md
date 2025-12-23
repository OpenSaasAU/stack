---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add db.foreignKey configuration for one-to-one relationships

Fixes issue #258 where one-to-one relationships generated invalid Prisma schemas with foreign keys on both sides. You can now explicitly control which side of a one-to-one relationship stores the foreign key.

**Usage:**

```typescript
// Specify which side has the foreign key
lists: {
  User: list({
    fields: {
      account: relationship({
        ref: 'Account.user',
        db: { foreignKey: true }
      })
    }
  }),
  Account: list({
    fields: {
      user: relationship({ ref: 'User.account' })
    }
  })
}
```

**Default behavior (without explicit db.foreignKey):**

For one-to-one relationships without explicit configuration, the foreign key is placed on the alphabetically first list name. For example, in a `User ↔ Profile` relationship, the `Profile` model will have the `userId` foreign key.

**Generated Prisma schema:**

```prisma
model User {
  id        String   @id @default(cuid())
  accountId String?  @unique
  account   Account? @relation(fields: [accountId], references: [id])
}

model Account {
  id   String @id @default(cuid())
  user User?
}
```

**Validation:**

- `db.foreignKey` can only be used on single relationships (not many-side)
- Cannot be set to `true` on both sides of a one-to-one relationship
- Only applies to bidirectional relationships (with target field specified)
