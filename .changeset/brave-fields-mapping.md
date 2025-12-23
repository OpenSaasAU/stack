---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add support for custom database column names via `db.map`

You can now customize database column names using Prisma's @map attribute, following Keystone's pattern:

**Regular fields:**

```typescript
fields: {
  firstName: text({
    db: { map: 'first_name' }
  }),
  email: text({
    isIndexed: 'unique',
    db: { map: 'email_address' }
  })
}
```

**Relationship foreign keys:**

```typescript
fields: {
  author: relationship({
    ref: 'User.posts',
    db: { foreignKey: { map: 'author_user_id' } },
  })
}
```

Foreign key columns now default to the field name (not `fieldNameId`) for better consistency with Keystone's behavior.
