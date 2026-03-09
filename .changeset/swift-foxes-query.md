---
'@opensaas/stack-core': minor
---

Add fragment-based, type-safe query utilities and integrate them into `context.db` operations

OpenSaaS Stack now ships `defineFragment`, `ResultOf`, and `RelationSelector` — composable query helpers that give you the same benefits as Keystone's GraphQL fragments (reuse, type inference, nesting) without a GraphQL runtime.

**Define reusable fragments:**

```ts
import type { User, Post } from '.prisma/client'
import { defineFragment, type ResultOf } from '@opensaas/stack-core'

const authorFragment = defineFragment<User>()({ id: true, name: true } as const)

const postFragment = defineFragment<Post>()({
  id: true,
  title: true,
  author: authorFragment, // nested relationship
} as const)

// Types are inferred — no codegen step required
type PostData = ResultOf<typeof postFragment>
// → { id: string; title: string; author: { id: string; name: string } | null }
```

**Pass fragments directly to `context.db` operations (primary API):**

```ts
// List — typed to ResultOf<typeof postFragment>[]
const posts = await context.db.post.findMany({
  query: postFragment,
  where: { published: true },
  orderBy: { publishedAt: 'desc' },
  take: 10,
})

// Single record — typed to ResultOf<typeof postFragment> | null
const post = await context.db.post.findUnique({
  where: { id: postId },
  query: postFragment,
})
if (!post) return notFound()
```

**Nested relationship filtering with `RelationSelector`:**

```ts
const commentFragment = defineFragment<Comment>()({ id: true, body: true } as const)

const postWithComments = defineFragment<Post>()({
  id: true,
  title: true,
  comments: {
    query: commentFragment,
    where: { approved: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  },
} as const)

const posts = await context.db.post.findMany({ query: postWithComments })
```

**Standalone helpers also available** for use in hooks and utilities:

```ts
import { runQuery, runQueryOne } from '@opensaas/stack-core'

const posts = await runQuery(context, 'Post', postFragment, { where: { published: true } })
const post = await runQueryOne(context, 'Post', postFragment, { id: postId })
```

Fragments compose freely and can be nested to any depth. Access control is always enforced — the `query` parameter only controls the include structure and field shape, not security. `orderBy` is now also supported in `context.db.<list>.findMany()`.

See `specs/keystone-migration.md` for a full migration guide from Keystone's `context.graphql.run`.
