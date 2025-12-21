---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add support for flexible relationship refs (list-only refs)

You can now specify relationship refs using just the list name, without requiring a corresponding field on the target list. This matches Keystone's behavior and simplifies one-way relationships.

**Bidirectional refs** (existing behavior, still works):

```typescript
lists: {
  User: list({
    fields: {
      posts: relationship({ ref: 'Post.author', many: true }),
    },
  }),
  Post: list({
    fields: {
      author: relationship({ ref: 'User.posts' }),
    },
  }),
}
```

**List-only refs** (new feature):

```typescript
lists: {
  Category: list({
    fields: {
      name: text(),
      // No relationship field needed!
    },
  }),
  Post: list({
    fields: {
      title: text(),
      // Just reference the list name
      category: relationship({ ref: 'Category' }),
    },
  }),
}
```

The generator automatically creates a synthetic field `from_Post_category` on the Category model with a named Prisma relation to avoid ambiguity. This is useful when you only need one-way access to the relationship.
