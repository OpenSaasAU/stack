---
name: migrate-context-calls
description: Migrate context.graphql.run/raw and context.query.* calls to context.db.* across a project. Invoke as a forked subagent when these patterns are detected, passing the project root path as arguments.
context: fork
agent: general-purpose
---

Search for and migrate all `context.graphql` and `context.query` calls in the project described below. OpenSaaS Stack has no GraphQL — use `context.db.{listName}.{method}()` directly.

$ARGUMENTS

## Migration Pattern

| Keystone                                    | OpenSaaS Stack                      |
| ------------------------------------------- | ----------------------------------- |
| `context.graphql.run({ query, variables })` | `context.db.{list}.{method}(args)`  |
| `context.graphql.raw({ query, variables })` | `context.db.{list}.{method}(args)`  |
| `context.query.PostList.findMany(...)`      | `context.db.post.findMany(...)`     |
| `context.query.PostList.count(...)`         | `context.db.post.count(...)`        |
| `context.sudo().graphql.run(...)`           | `context.sudo().db.post.findMany()` |

**List names are camelCase**: `Post` → `context.db.post`, `BlogPost` → `context.db.blogPost`, `AuthUser` → `context.db.authUser`.

**Access control** is automatically enforced by `context.db`. Use `context.sudo().db.*` to bypass it (equivalent to Keystone's `context.sudo()`).

**Null handling**: `context.db` returns `null` (single item) or `[]` (list) on access denial — never throws. Check for null after writes.

## Common Conversions

### findMany / query list

```typescript
// Before
const { posts } = await context.graphql.run({
  query: `query GetPosts($authorId: ID!) {
    posts(where: { author: { id: { equals: $authorId } } }, orderBy: [{ createdAt: desc }], take: 10) {
      id title createdAt
    }
  }`,
  variables: { authorId },
})

// After
const posts = await context.db.post.findMany({
  where: { authorId: { equals: authorId } },
  orderBy: { createdAt: 'desc' },
  take: 10,
})
```

### findOne / single item

```typescript
// Before
const { post } = await context.graphql.run({
  query: `query { post(where: { id: $id }) { id title content } }`,
  variables: { id: postId },
})

// After
const post = await context.db.post.findUnique({ where: { id: postId } })
```

### create

```typescript
// Before
const { createPost } = await context.graphql.run({
  query: `mutation { createPost(data: $data) { id title } }`,
  variables: { data: { title: 'Hello', content: '...' } },
})

// After
const post = await context.db.post.create({ data: { title: 'Hello', content: '...' } })
```

### update

```typescript
// Before
await context.graphql.run({
  query: `mutation { updatePost(where: { id: $id }, data: $data) { id } }`,
  variables: { id: postId, data: { title: 'Updated' } },
})

// After
const updated = await context.db.post.update({ where: { id: postId }, data: { title: 'Updated' } })
if (!updated) {
  /* access denied or not found */
}
```

### delete

```typescript
// Before
await context.graphql.run({
  query: `mutation { deletePost(where: { id: $id }) { id } }`,
  variables: { id: postId },
})

// After
await context.db.post.delete({ where: { id: postId } })
```

### count

```typescript
// Before
const { postsCount } = await context.graphql.run({
  query: `query { postsCount(where: { status: { equals: published } }) }`,
})

// After
const count = await context.db.post.count({ where: { status: { equals: 'published' } } })
```

### Nested / related data (fragment passed to context.db — recommended)

OpenSaaS Stack provides `defineFragment` for composable, type-safe queries that include related data in a single call — the closest equivalent to Keystone's GraphQL fragments. Pass the fragment directly to `context.db` operations using the `query` parameter.

```typescript
// Before — one GraphQL query with nested author and tags
const { posts } = await context.graphql.run({
  query: `
    fragment AuthorFields on User { id name }
    query GetPosts {
      posts(where: { published: true }) {
        id title author { ...AuthorFields } tags { id name }
      }
    }
  `,
})

// After — define fragments once, compose and reuse them
import type { User, Post, Tag } from '.prisma/client'
import { defineFragment, type ResultOf } from '@opensaas/stack-core'

const authorFragment = defineFragment<User>()({ id: true, name: true } as const)
const tagFragment = defineFragment<Tag>()({ id: true, name: true } as const)
const postFragment = defineFragment<Post>()({
  id: true,
  title: true,
  author: authorFragment, // nested fragment → loaded via Prisma include
  tags: tagFragment,      // many relationship
} as const)

// Type-inferred — no codegen needed
type PostData = ResultOf<typeof postFragment>
// → { id: string; title: string; author: { id: string; name: string } | null; tags: { id: string; name: string }[] }

// Primary API: pass query fragment to context.db.findMany
const posts = await context.db.post.findMany({
  query: postFragment,
  where: { published: true },
  orderBy: { publishedAt: 'desc' },
})
// posts: PostData[]
```

For single-record queries:

```typescript
const post = await context.db.post.findUnique({
  where: { id: postId },
  query: postFragment,
})
if (!post) return notFound()
// post: PostData
```

For nested relationship filtering (e.g., only load approved comments):

```typescript
const commentFragment = defineFragment<Comment>()({ id: true, body: true } as const)

const postWithComments = defineFragment<Post>()({
  id: true,
  title: true,
  comments: {
    query: commentFragment,
    where: { approved: true },   // filter nested relationship
    orderBy: { createdAt: 'desc' },
    take: 5,
  },
} as const)

const posts = await context.db.post.findMany({ query: postWithComments })
```

Standalone `runQuery` / `runQueryOne` helpers are also available for use in hooks or utilities where `context.db` is available but direct method call is inconvenient:

```typescript
import { runQuery, runQueryOne } from '@opensaas/stack-core'

const posts = await runQuery(context, 'Post', postFragment, { where: { published: true } })
const post = await runQueryOne(context, 'Post', postFragment, { id: postId })
```

### Nested / related data (separate context.db calls — simpler alternative)

If you only need one level of nesting without fragment reuse, separate calls are fine:

```typescript
// Before — one query with nested author
const { post } = await context.graphql.run({
  query: `query { post(where: { id: $id }) { id title author { id name } } }`,
  variables: { id: postId },
})

// After — separate calls
const post = await context.db.post.findUnique({ where: { id: postId } })
const author = post?.authorId
  ? await context.db.user.findUnique({ where: { id: post.authorId } })
  : null
const authorName = author?.name
```

### Sudo (bypass access control)

```typescript
// Before
const allPosts = await context.sudo().graphql.run({ query: '...' })

// After
const allPosts = await context.sudo().db.post.findMany()
```

## Steps

1. Use Grep to find all occurrences of `context.graphql`, `context.query`, and `context.sudo().graphql` in the project (search `.ts`, `.tsx` files, exclude `node_modules`)
2. For each occurrence:
   a. Read the file to understand the full query/mutation
   b. Identify the operation type:
   - **Read with nested data** → prefer `context.db.{list}.findMany/findUnique({ query: fragment })` with `defineFragment` (see pattern above)
   - **Simple read** → `context.db.{list}.findMany()` / `findUnique()`
   - **Create / update / delete** → `context.db.{list}.create()` / `update()` / `delete()`
   - **Count** → `context.db.{list}.count()`
     c. Identify the list name (convert to camelCase for `context.db`)
     d. Rewrite using the appropriate pattern above
     e. For fragment-based rewrites: create a shared `fragments.ts` file and import from it
3. After all edits: check that any `import ... from '@keystone-6/core'` imports used only for graphql types are removed or reduced; also remove any GraphQL codegen type imports (replace with `ResultOf<typeof fragment>`)
4. Report: list every file changed and summarise what was replaced
