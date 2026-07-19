# Queries & Fragments

OpenSaaS Stack has **no GraphQL layer**. Instead of `context.graphql.run()`, it provides first-class, type-safe query utilities that give you the same benefits KeystoneJS users relied on — fragment reuse, composability, and inferred result types — without GraphQL at runtime.

The building blocks are:

- **`defineFragment`** — declare a reusable, composable field selection for a model.
- **`runQuery` / `runQueryOne`** — standalone helpers that execute a fragment against a list.
- **`ResultOf`** — a type utility that infers the exact result shape from a fragment (no codegen step).

All fragment queries run through `context.db` under the hood, so your [access control](/docs/concepts/access-control) rules are always enforced.

{% callout type="info" %}
Migrating from Keystone? See the [Migrating from KeystoneJS](/docs/how-to/migrate-from-keystone) guide and the [`context.graphql.run` quick reference](/docs/how-to/migrate#migrating-contextgraphqlrun) for a side-by-side translation table.
{% /callout %}

## `defineFragment`

`defineFragment` creates a reusable field-selection descriptor for a model type. It is curried so TypeScript can infer both the model type (from the type parameter) and the field selection (from the argument).

Each key in the selection maps to:

- `true` — include the scalar field as-is.
- A `Fragment` — include a relationship and recurse (shorthand).
- A `RelationSelector` — include a relationship with optional Prisma `where`/`orderBy`/`take`/`skip`.

```typescript
import type { User, Post } from '.prisma/client'
import { defineFragment } from '@opensaas/stack-core'

export const userFragment = defineFragment<User>()({
  id: true,
  name: true,
  email: true,
} as const)

// Compose fragments by referencing one inside another
export const postFragment = defineFragment<Post>()({
  id: true,
  title: true,
  publishedAt: true,
  author: userFragment, // nested — access-controlled include
} as const)
```

{% callout type="info" %}
Always close the selection object with `as const`. This preserves the literal field selection so `ResultOf` can narrow the result type precisely.
{% /callout %}

## `ResultOf`

`ResultOf` infers the TypeScript result type from a fragment — analogous to `gql.tada`'s `ResultOf`, but built-in and with no codegen step.

- Scalar fields selected with `true` keep their original Prisma type.
- Relationship fields selected with a nested fragment are recursively narrowed.
- Nullability and array wrappers from the original model are preserved.

```typescript
import { type ResultOf } from '@opensaas/stack-core'

type UserData = ResultOf<typeof userFragment>
// → { id: string; name: string; email: string }

type PostData = ResultOf<typeof postFragment>
// → { id: string; title: string; publishedAt: Date | null;
//     author: { id: string; name: string; email: string } | null }
```

## Running queries

There are two equivalent ways to execute a fragment.

### Via `context.db` (primary API)

Pass the fragment to any `context.db` read operation as the `query` argument:

```typescript
// List query with where / orderBy / pagination
const posts = await context.db.post.findMany({
  query: postFragment,
  where: { published: true },
  orderBy: { publishedAt: 'desc' },
  take: 10,
})
// posts: PostData[]

// Single record — null means "not found OR access denied"
const post = await context.db.post.findUnique({
  where: { id: postId },
  query: postFragment,
})
if (!post) return notFound()
// post: PostData
```

{% callout type="warning" %}
`context.db` reads do **not** honour Prisma's `select` argument. Narrow a read with `include` (for relationships) or a fragment `query` instead. Passing `select` to `findUnique`/`findMany` is a no-op: it logs a runtime warning and the full, access-filtered record is still returned (field-level visibility is always enforced by [access control](/docs/concepts/access-control), regardless of `select`).
{% /callout %}

### Via `runQuery` / `runQueryOne` (standalone helpers)

When you don't have direct access to `context.db` (for example inside a hook or a shared utility), use the standalone helpers. They take the `context`, the PascalCase list key, the fragment, and query args:

```typescript
import { runQuery, runQueryOne } from '@opensaas/stack-core'

// Equivalent to context.db.post.findMany({ query: postFragment, where, ... })
const posts = await runQuery(context, 'Post', postFragment, {
  where: { published: true },
  orderBy: { publishedAt: 'desc' },
  take: 10,
})
// posts: ResultOf<typeof postFragment>[]

// Equivalent to context.db.post.findFirst({ where: { id }, query: postFragment })
const post = await runQueryOne(context, 'Post', postFragment, { id: postId })
// post: ResultOf<typeof postFragment> | null
if (!post) return notFound()
```

Both forms produce the same result and enforce the same access control.

## Nested relationship filtering with `RelationSelector`

To filter, sort, or paginate a nested relationship **within the same query**, use a `RelationSelector` object — `{ query, where?, orderBy?, take?, skip? }` — instead of a plain fragment:

```typescript
import type { Post, Comment } from '.prisma/client'
import { defineFragment, type ResultOf } from '@opensaas/stack-core'

const commentFragment = defineFragment<Comment>()({ id: true, body: true } as const)

const postWithApprovedComments = defineFragment<Post>()({
  id: true,
  title: true,
  comments: {
    query: commentFragment, // nested fragment
    where: { approved: true }, // Prisma filter on the relationship
    orderBy: { createdAt: 'desc' },
    take: 5,
  },
} as const)

type PostWithComments = ResultOf<typeof postWithApprovedComments>
// → { id: string; title: string; comments: { id: string; body: string }[] }

const posts = await context.db.post.findMany({ query: postWithApprovedComments })
```

## Variables via factory functions

Fragments are plain objects, so for runtime filter values just wrap `defineFragment` in a factory function and infer the type from its return:

```typescript
function makePostFragment(status: string) {
  return defineFragment<Post>()({
    id: true,
    title: true,
    comments: { query: commentFragment, where: { status } },
  } as const)
}

type PostData = ResultOf<ReturnType<typeof makePostFragment>>

const posts = await context.db.post.findMany({
  query: makePostFragment('approved'),
  where: { published: true },
})
```

## Coming from `context.graphql.run`?

| Keystone                                             | OpenSaaS Stack                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| GraphQL fragment string                              | `defineFragment<T>()(fields)`                                      |
| `ResultOf<typeof query>` (codegen)                   | `ResultOf<typeof fragment>` (built-in)                             |
| `context.graphql.run({ query, variables })` — list   | `context.db.post.findMany({ query: fragment, where?, ... })`       |
| `context.graphql.run({ query, variables })` — single | `context.db.post.findUnique({ where: { id }, query: fragment })`   |
| Standalone GraphQL client call                       | `runQuery(context, listKey, fragment, args)` / `runQueryOne(...)`  |
| Nested relationship filtering                        | `RelationSelector`: `{ query: fragment, where?, orderBy?, take? }` |

For the complete set of migration recipes (deeply nested fragments, many-to-many, reuse across parents), see [Migrating from KeystoneJS](/docs/how-to/migrate-from-keystone) and the [Migrating context.graphql.run](/docs/how-to/migrate#migrating-contextgraphqlrun) section of the Migration Guide.
