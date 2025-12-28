---
'@opensaas/stack-cli': minor
---

Add full Prisma filter operator support to WhereInput types

The generated `WhereInput` types now expose all of Prisma's filter operators instead of just `equals` and `not`. This resolves GitHub issue #318.

**String fields** now support:

```typescript
const where: PostWhereInput = {
  title: {
    contains: 'search',
    startsWith: 'Hello',
    endsWith: '!',
    in: ['Post 1', 'Post 2'],
    notIn: ['Spam'],
    mode: 'insensitive', // case-insensitive search
  },
}
```

**Number fields** now support:

```typescript
const where: PostWhereInput = {
  viewCount: {
    gte: 100, // greater than or equal
    lte: 1000, // less than or equal
    gt: 50, // greater than
    lt: 500, // less than
    in: [10, 20, 30],
    notIn: [0],
  },
}
```

**DateTime fields** now support:

```typescript
const where: PostWhereInput = {
  publishDate: {
    gte: new Date('2024-01-01'),
    lte: new Date('2024-12-31'),
  },
}
```

**Boolean operators** now match Prisma's structure:

```typescript
const where: PostWhereInput = {
  // AND can be single object OR array
  AND: { status: { equals: 'published' } },
  // OR is array-only
  OR: [{ status: { in: ['published', 'draft'] } }, { title: { contains: 'important' } }],
  // NOT can be single object OR array
  NOT: { status: { equals: 'archived' } },
}
```

No migration required - this change is fully backward compatible. Existing code using `equals` and `not` will continue to work.
