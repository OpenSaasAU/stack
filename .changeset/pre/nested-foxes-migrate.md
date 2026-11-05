---
'@opensaas/stack-core': minor
---

Fix a to-one relation's foreign-key column colliding with the relation's own alias (#1236). This broke nested to-one includes (`column reference "…" is ambiguous`) and could make a field-level rule that reads `item.<relation>Id` directly answer wrong — an allow flipping to a deny, or a deny flipping to a **disclosure**, depending on whether the caller happened to include the relation.

The fix changes the foreign key's default physical column name, which is a **schema change** for any list using a to-one relationship that did not set `db.foreignKey.map` explicitly: the physical column moves from the relation's own name (`author`) to the contract member's name (`authorId`) — the two are no longer forced to disagree.

Before deploying this version against an existing database, rename each affected column so the deploy reconciles against a schema that already matches (no destructive diff for a rename-detection tool to get wrong):

```sql
ALTER TABLE "Post" RENAME COLUMN "author" TO "authorId";
```

Run one such statement per to-one relationship field that relies on the default (i.e. every one that does not set `db.foreignKey.map`). There is no way to opt out and keep the old column name — `db.foreignKey.map` set to the field's own name is now a generate-time refusal, because that is exactly the collision this release closes.

The read-boundary workaround this collision required (`restoreForeignKeys` and its helpers, and `NestedToOneIncludeError`) is removed now that the collision cannot occur — a nested to-one include just works:

```typescript
await context.db.User.include('posts', (posts) => posts.include('author')).all()
```
