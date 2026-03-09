---
'@opensaas/stack-core': minor
---

Add fragment-based, type-safe query utilities for migrating from `context.graphql.run`

OpenSaaS Stack now ships `defineFragment`, `runQuery`, and `runQueryOne` — composable query helpers that give you the same benefits as Keystone's GraphQL fragments (reuse, type inference, nesting) without a GraphQL runtime.

**Define reusable fragments:**

```ts
import type { User, Post } from '.prisma/client'
import { defineFragment, type ResultOf } from '@opensaas/stack-core'

const authorFragment = defineFragment<User>()({ id: true, name: true } as const)

const postFragment = defineFragment<Post>()({
  id:     true,
  title:  true,
  author: authorFragment,   // nested relationship
} as const)

// Types are inferred — no codegen step required
type PostData = ResultOf<typeof postFragment>
// → { id: string; title: string; author: { id: string; name: string } | null }
```

**Run queries (respects access control):**

```ts
import { runQuery, runQueryOne } from '@opensaas/stack-core'

// List — replaces context.graphql.run with a query { posts { ... } }
const posts = await runQuery(context, 'Post', postFragment, {
  where:   { published: true },
  orderBy: { publishedAt: 'desc' },
  take:    10,
})
// posts: PostData[]

// Single record — replaces context.graphql.run with a query { post(where: ...) { ... } }
const post = await runQueryOne(context, 'Post', postFragment, { id: postId })
if (!post) return notFound()
// post: PostData
```

Fragments compose freely and can be nested to any depth. The same fragment instance can be reused in multiple parent fragments.

See `specs/keystone-migration.md` for a full migration guide from Keystone's `context.graphql.run`.
