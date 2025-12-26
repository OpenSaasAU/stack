---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add field-level `extendPrismaSchema` support for relationship fields

Relationship fields now support `extendPrismaSchema` in their `db` config, allowing granular modification of generated Prisma schema lines. This is useful for self-referential relationships that need custom `onDelete` or `onUpdate` actions.

```typescript
parent: relationship({
  ref: 'Category.children',
  db: {
    foreignKey: true,
    extendPrismaSchema: ({ fkLine, relationLine }) => ({
      fkLine,
      relationLine: relationLine.replace(
        '@relation(',
        '@relation(onDelete: SetNull, onUpdate: Cascade, ',
      ),
    }),
  },
})
```

The function receives `fkLine` (the foreign key field line, only present for single relationships that own the FK) and `relationLine` (the relation field line), and returns the modified lines.

Fixes #284
