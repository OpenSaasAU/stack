---
name: keystone-virtual-fields-context
description: Detailed migration patterns for Keystone virtual fields and context.graphql → context.db when migrating to OpenSaaS Stack. Invoke this skill when virtual fields or context.graphql usage is detected in a project.
---

# Keystone: Virtual Fields & context.graphql Migration

Detailed patterns for the two areas that differ most between Keystone and OpenSaaS Stack.

## Virtual Fields

Keystone virtual fields use GraphQL's type system. OpenSaaS Stack has no GraphQL — virtual fields use `hooks.resolveOutput` instead.

### Before (Keystone)

```typescript
import { virtual } from '@keystone-6/core/fields'
import { graphql } from '@keystone-6/core'

fields: {
  // Simple computed string
  fullName: virtual({
    field: graphql.field({
      type: graphql.String,
      resolve: (item) => `${item.firstName} ${item.lastName}`,
    }),
  }),

  // Computed with context (e.g. related count)
  postCount: virtual({
    field: graphql.field({
      type: graphql.Int,
      resolve: async (item, _, context) => {
        return context.query.Post.count({
          where: { author: { id: { equals: item.id } } },
        })
      },
    }),
  }),

  // With arguments
  excerpt: virtual({
    field: graphql.field({
      type: graphql.String,
      args: { length: graphql.arg({ type: graphql.nonNull(graphql.Int) }) },
      resolve: (item, { length }) => item.content?.slice(0, length),
    }),
  }),
}
```

### After (OpenSaaS Stack)

```typescript
import { virtual } from '@opensaas/stack-core/fields'

fields: {
  // Simple computed string
  fullName: virtual({
    type: 'string',
    hooks: {
      resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
    },
  }),

  // Computed with context — use context.db not context.query
  postCount: virtual({
    type: 'number',
    hooks: {
      resolveOutput: async ({ item, context }) => {
        return context.db.post.count({
          where: { authorId: { equals: item.id } },
        })
      },
    },
  }),

  // Arguments are NOT supported — use a fixed value or split into separate fields
  excerpt: virtual({
    type: 'string',
    hooks: {
      resolveOutput: ({ item }) => item.content?.slice(0, 200),
    },
  }),
}
```

### Key Differences

| Keystone                                           | OpenSaaS Stack                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| `graphql.field({ type: graphql.String, resolve })` | `{ type: 'string', hooks: { resolveOutput } }`                        |
| `resolve(item, args, context)`                     | `resolveOutput({ item, context })`                                    |
| `context.query.Post.count(...)`                    | `context.db.post.count(...)`                                          |
| Field arguments supported                          | Field arguments NOT supported                                         |
| `graphql.Int`, `graphql.Boolean` etc.              | `'number'`, `'boolean'` etc.                                          |
| Custom types via `graphql.object()`                | Custom types via type descriptor `{ value: MyClass, from: 'my-pkg' }` |

### Type Mappings

| Keystone GraphQL type           | OpenSaaS `type` value                      |
| ------------------------------- | ------------------------------------------ |
| `graphql.String`                | `'string'`                                 |
| `graphql.Int` / `graphql.Float` | `'number'`                                 |
| `graphql.Boolean`               | `'boolean'`                                |
| Custom object type              | `{ value: MyClass, from: 'package-name' }` |
| `graphql.list(graphql.String)`  | `'string[]'`                               |

### Custom Types (e.g. Decimal for financial fields)

```typescript
import Decimal from 'decimal.js'

fields: {
  totalPrice: virtual({
    // Type descriptor: OpenSaaS generates the correct import
    type: { value: Decimal, from: 'decimal.js' },
    hooks: {
      resolveOutput: ({ item }) =>
        new Decimal(item.price).times(item.quantity),
    },
  }),
}
```

### Checklist

- [ ] Remove all `graphql.field()`, `graphql.String`, `graphql.Int` etc. references from virtual fields
- [ ] Replace `resolve(item, args, context)` with `hooks: { resolveOutput: ({ item, context }) => ... }`
- [ ] Replace `context.query.*` calls inside resolveOutput with `context.db.*`
- [ ] Remove any field `args` (not supported) — bake in defaults or split into multiple fields
- [ ] Update `type` to a string literal or type descriptor object

---

## context.graphql → context.db

Keystone provides `context.graphql.run()` and `context.graphql.raw()` for type-safe data access from API routes, server actions, and hooks. OpenSaaS Stack uses `context.db.{listName}.{method}()` directly — the same access control rules apply automatically.

List names are **camelCase** in `context.db`: `Post` → `context.db.post`, `BlogPost` → `context.db.blogPost`.

### Query (findMany)

```typescript
// Keystone
const { posts } = await context.graphql.run({
  query: `query {
    posts(where: { status: { equals: published } }) {
      id title publishedAt
    }
  }`,
})

// OpenSaaS Stack
const posts = await context.db.post.findMany({
  where: { status: { equals: 'published' } },
})
```

### Query with filters and ordering

```typescript
// Keystone
const { posts } = await context.graphql.run({
  query: `query GetAuthorPosts($authorId: ID!) {
    posts(
      where: { author: { id: { equals: $authorId } } }
      orderBy: [{ createdAt: desc }]
      take: 10
    ) { id title createdAt }
  }`,
  variables: { authorId: userId },
})

// OpenSaaS Stack
const posts = await context.db.post.findMany({
  where: { authorId: { equals: userId } },
  orderBy: { createdAt: 'desc' },
  take: 10,
})
```

### Query single item

```typescript
// Keystone
const { post } = await context.graphql.run({
  query: `query GetPost($id: ID!) {
    post(where: { id: $id }) { id title content }
  }`,
  variables: { id: postId },
})

// OpenSaaS Stack
const post = await context.db.post.findUnique({
  where: { id: postId },
})
```

### Create

```typescript
// Keystone
const { createPost } = await context.graphql.run({
  query: `mutation CreatePost($data: PostCreateInput!) {
    createPost(data: $data) { id title }
  }`,
  variables: { data: { title: 'Hello', content: '...' } },
})

// OpenSaaS Stack
const post = await context.db.post.create({
  data: { title: 'Hello', content: '...' },
})
```

### Update

```typescript
// Keystone
const { updatePost } = await context.graphql.run({
  query: `mutation UpdatePost($id: ID!, $data: PostUpdateInput!) {
    updatePost(where: { id: $id }, data: $data) { id title }
  }`,
  variables: { id: postId, data: { title: 'Updated' } },
})

// OpenSaaS Stack
const post = await context.db.post.update({
  where: { id: postId },
  data: { title: 'Updated' },
})
// Returns null if access denied or not found
if (!post) return { error: 'Access denied' }
```

### Delete

```typescript
// Keystone
await context.graphql.run({
  query: `mutation DeletePost($id: ID!) {
    deletePost(where: { id: $id }) { id }
  }`,
  variables: { id: postId },
})

// OpenSaaS Stack
const deleted = await context.db.post.delete({
  where: { id: postId },
})
```

### Count

```typescript
// Keystone
const { postsCount } = await context.graphql.run({
  query: `query { postsCount(where: { status: { equals: published } }) }`,
})

// OpenSaaS Stack
const count = await context.db.post.count({
  where: { status: { equals: 'published' } },
})
```

### Related data

Keystone returns nested GraphQL results in a single query. OpenSaaS Stack does the same in one call with a fragment (`defineFragment` + the `query` param) — see the `migrate-context-calls` skill for the full pattern:

```typescript
// Keystone — nested in one query
const { post } = await context.graphql.run({
  query: `query GetPost($id: ID!) {
    post(where: { id: $id }) {
      id title
      author { id name email }
      tags { id name }
    }
  }`,
  variables: { id: postId },
})

// OpenSaaS Stack — one call with a fragment
import type { User, Post, Tag } from '@/.opensaas/prisma-client/client'
import { defineFragment } from '@opensaas/stack-core'

const postFragment = defineFragment<Post>()({
  id: true,
  title: true,
  author: defineFragment<User>()({ id: true, name: true, email: true } as const),
  tags: defineFragment<Tag>()({ id: true, name: true } as const),
} as const)

const post = await context.db.post.findUnique({
  where: { id: postId },
  query: postFragment,
})
```

### Bypassing access control (sudo)

```typescript
// Keystone
const sudoContext = context.sudo()
const { posts } = await sudoContext.graphql.run({ query: '...' })

// OpenSaaS Stack
const posts = await context.sudo().db.post.findMany()
```

### Key Differences

| Keystone                                    | OpenSaaS Stack                                       |
| ------------------------------------------- | ---------------------------------------------------- |
| `context.graphql.run({ query, variables })` | `context.db.{list}.{method}(args)`                   |
| `context.graphql.raw({ query, variables })` | `context.db.{list}.{method}(args)`                   |
| Nested related data in one query            | Separate `context.db` calls per list                 |
| Returns `{ data: { listName: [...] } }`     | Returns result directly (or `null` on access denial) |
| GraphQL string queries                      | Prisma-style filter objects                          |
| `context.query.*` (also Keystone)           | `context.db.*`                                       |
| `context.sudo().graphql.*`                  | `context.sudo().db.*`                                |

### Checklist

- [ ] Search for all `context.graphql.run(` and `context.graphql.raw(` calls
- [ ] Search for all `context.query.` calls (another Keystone API)
- [ ] Replace with `context.db.{camelCaseListName}.{method}()`
- [ ] Break nested GraphQL queries into separate `context.db` calls
- [ ] Handle `null` returns (OpenSaaS returns null on access denial, not errors)
- [ ] Replace `context.sudo().graphql.*` with `context.sudo().db.*`
