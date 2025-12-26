---
'@opensaas/stack-cli': minor
---

Add relationship field support to WhereInput types

Generated WhereInput types now include relationship fields, enabling access control filters that traverse relationships:

```typescript
// One-to-many relationships use some/every/none
const userFilter: UserWhereInput = {
  posts: {
    some: {
      status: { equals: 'published' },
    },
  },
}

// Many-to-one relationships use direct nesting
const postFilter: PostWhereInput = {
  author: {
    email: { equals: 'user@example.com' },
  },
}

// Complex nested filters are now possible
const complexFilter: PostWhereInput = {
  AND: [
    { status: { equals: 'published' } },
    {
      author: {
        posts: {
          some: { status: { equals: 'published' } },
        },
      },
    },
  ],
}
```

This enables common access control patterns like filtering students by their account's user:

```typescript
export function studentFilter({ session }: { session: Session | null }): StudentWhereInput {
  return {
    account: {
      user: { id: { equals: session?.userId } },
    },
  }
}
```
