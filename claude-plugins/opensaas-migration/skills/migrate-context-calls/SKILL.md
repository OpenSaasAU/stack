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

### Nested / related data

GraphQL allows fetching related data in one query. OpenSaaS Stack requires separate `context.db` calls:

```typescript
// Before — one query with nested author
const { post } = await context.graphql.run({
  query: `query { post(where: { id: $id }) { id title author { id name } } }`,
  variables: { id: postId },
})
const authorName = post.author.name

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
   b. Identify the list name (convert to camelCase for `context.db`)
   c. Identify the operation (findMany, findUnique, create, update, delete, count)
   d. Rewrite using the `context.db` pattern above
   e. For nested data: split into separate `context.db` calls
3. After all edits: check that any `import ... from '@keystone-6/core'` imports used only for graphql types are removed or reduced
4. Report: list every file changed and summarise what was replaced
