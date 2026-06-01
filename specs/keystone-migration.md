# Migrating from KeystoneJS to OpenSaas Stack

This guide is intended for both human developers and AI agents tasked with migrating a Keystone 6 project to the OpenSaas Stack.

---

## Overview of differences

| Concern                 | Keystone 6                            | OpenSaas Stack                               |
| ----------------------- | ------------------------------------- | -------------------------------------------- |
| Schema definition       | `list()` in `schema.ts`               | `list()` in `opensaas.config.ts`             |
| Database                | Prisma (managed by Keystone)          | Prisma 7 with driver adapters                |
| Access control          | Functions on `access` key             | Same pattern (compatible API)                |
| Hooks                   | `resolveInput`, `validateInput`, etc. | Same names + `resolveOutput`                 |
| GraphQL API             | Built-in, always on                   | **Not provided**                             |
| `context.graphql.run()` | Run raw GraphQL queries               | `runQuery` / `runQueryOne` (see below)       |
| Type generation         | GraphQL codegen                       | Built-in TypeScript inference via `ResultOf` |
| Auth                    | `@keystone-6/auth`                    | `@opensaas/stack-auth`                       |
| Admin UI                | Auto-generated from schema            | Auto-generated from config                   |

---

## 1. Config migration

### Keystone (`schema.ts` + `keystone.ts`)

```typescript
// schema.ts
import { list } from '@keystone-6/core'
import { text, relationship, timestamp } from '@keystone-6/core/fields'

export const lists = {
  Post: list({
    fields: {
      title: text({ validation: { isRequired: true } }),
      author: relationship({ ref: 'User.posts' }),
      publishedAt: timestamp(),
    },
    access: {
      operation: {
        query: () => true,
        create: ({ session }) => !!session,
        update: ({ session }) => !!session,
        delete: ({ session }) => !!session,
      },
    },
  }),
  User: list({
    fields: {
      name: text(),
      email: text({ isIndexed: 'unique' }),
      posts: relationship({ ref: 'Post.author', many: true }),
    },
  }),
}
```

### OpenSaas Stack (`opensaas.config.ts`)

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, relationship, timestamp } from '@opensaas/stack-core/fields'

export default config({
  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL ?? 'file:./dev.db',
    prismaClientConstructor: (PrismaClient) => {
      // Prisma 7 requires a driver adapter
      const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3')
      return new PrismaClient({
        adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' }),
      })
    },
  },
  lists: {
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        author: relationship({ ref: 'User.posts' }),
        publishedAt: timestamp(),
      },
      access: {
        operation: {
          query: () => true,
          create: ({ session }) => !!session,
          update: ({ session }) => !!session,
          delete: ({ session }) => !!session,
        },
      },
    }),
    User: list({
      fields: {
        name: text(),
        email: text(),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
    }),
  },
})
```

**Key differences:**

- `config()` wraps all lists in a single default export.
- Database config (`db`) is required and must include `prismaClientConstructor` for Prisma 7.
- Field imports come from `@opensaas/stack-core/fields` (not `@keystone-6/core/fields`).

---

## 2. Replacing `context.graphql.run` with fragment-based queries

This is the most significant API change. OpenSaas Stack does **not** include a GraphQL layer. Instead it provides first-class TypeScript utilities that give you the same benefits — fragment reuse, type inference, composability — without GraphQL at runtime.

### Concept mapping

| GraphQL / Keystone concept                  | OpenSaas Stack equivalent                                         |
| ------------------------------------------- | ----------------------------------------------------------------- |
| GraphQL fragment                            | `defineFragment<T>()(fields)`                                     |
| `ResultOf<typeof query>`                    | `ResultOf<typeof fragment>`                                       |
| `VariablesOf<typeof query>`                 | `QueryArgs` (or your own Prisma where type)                       |
| `context.graphql.run({ query, variables })` | `context.db.post.findMany({ query: fragment, where, ... })`       |
| Single-record query                         | `context.db.post.findUnique({ where: { id }, query: fragment })`  |
| Standalone query helpers                    | `runQuery(context, listKey, fragment, args)` / `runQueryOne(...)` |

### Import

```typescript
import { defineFragment, type ResultOf, type RelationSelector } from '@opensaas/stack-core'
```

---

### Pattern A — simple list query

**Before (Keystone):**

```typescript
const { data } = await context.graphql.run({
  query: `
    query {
      posts {
        id
        title
        publishedAt
      }
    }
  `,
})
const posts = data.posts // typed as any, or via codegen
```

**After (OpenSaas Stack):**

```typescript
import type { Post } from '.prisma/client'
import { defineFragment, type ResultOf } from '@opensaas/stack-core'

const postFragment = defineFragment<Post>()({
  id: true,
  title: true,
  publishedAt: true,
} as const)

// Type inferred automatically — no codegen needed
type PostData = ResultOf<typeof postFragment>
// → { id: string; title: string; publishedAt: Date | null }

// Primary API: fragment passed directly to context.db operations
const posts = await context.db.post.findMany({ query: postFragment })
// posts: PostData[]
```

---

### Pattern B — query with where / orderBy / pagination

**Before (Keystone):**

```typescript
const { data } = await context.graphql.run({
  query: `
    query GetPosts($where: PostWhereInput, $take: Int, $skip: Int) {
      posts(where: $where, take: $take, skip: $skip) {
        id
        title
      }
    }
  `,
  variables: {
    where: { status: { equals: 'published' } },
    take: 10,
    skip: 0,
  },
})
```

**After (OpenSaas Stack):**

```typescript
const posts = await context.db.post.findMany({
  query: postFragment,
  where: { status: 'published' },
  orderBy: { publishedAt: 'desc' },
  take: 10,
  skip: 0,
})
// posts: PostData[]
```

---

### Pattern C — single record

**Before (Keystone):**

```typescript
const { data } = await context.graphql.run({
  query: `
    query GetPost($id: ID!) {
      post(where: { id: $id }) {
        id
        title
        content
      }
    }
  `,
  variables: { id: postId },
})
const post = data.post
```

**After (OpenSaas Stack):**

```typescript
const post = await context.db.post.findUnique({
  where: { id: postId },
  query: postFragment,
})
if (!post) return notFound() // null means not found or access denied
```

---

### Pattern D — reusable fragments with nested relationships

One of Keystone's killer features was composable GraphQL fragments. OpenSaas Stack keeps this pattern with `defineFragment`.

**Before (Keystone):**

```graphql
# fragments.graphql
fragment AuthorFields on User {
  id
  name
  email
}

fragment PostSummary on Post {
  id
  title
  publishedAt
  author {
    ...AuthorFields
  }
}
```

```typescript
import { POST_SUMMARY } from './fragments.graphql'

const { data } = await context.graphql.run({
  query: `
    query { posts { ...PostSummary } }
    ${POST_SUMMARY}
    ${AUTHOR_FIELDS}
  `,
})
```

**After (OpenSaas Stack):**

```typescript
// fragments.ts  — a single source of truth, fully typed
import type { User, Post } from '.prisma/client'
import { defineFragment, type ResultOf } from '@opensaas/stack-core'

export const authorFragment = defineFragment<User>()({
  id: true,
  name: true,
  email: true,
} as const)

export const postSummaryFragment = defineFragment<Post>()({
  id: true,
  title: true,
  publishedAt: true,
  author: authorFragment, // ← compose fragments
} as const)

// Infer types — no GraphQL codegen step
export type AuthorData = ResultOf<typeof authorFragment>
// → { id: string; name: string; email: string }

export type PostSummaryData = ResultOf<typeof postSummaryFragment>
// → { id: string; title: string; publishedAt: Date | null; author: AuthorData | null }
```

```typescript
// Usage in a server action or route handler
import { postSummaryFragment } from './fragments'

const posts = await context.db.post.findMany({
  query: postSummaryFragment,
  where: { published: true },
  orderBy: { publishedAt: 'desc' },
})
// posts is PostSummaryData[]
```

---

### Pattern E — many-to-many relationships

**Before (Keystone):**

```graphql
fragment PostWithTags on Post {
  id
  title
  tags {
    id
    name
  }
}
```

**After (OpenSaas Stack):**

```typescript
import type { Post, Tag } from '.prisma/client'

const tagFragment = defineFragment<Tag>()({ id: true, name: true } as const)

const postWithTagsFragment = defineFragment<Post>()({
  id: true,
  title: true,
  tags: tagFragment, // many relationship → array in ResultOf
} as const)

type PostWithTags = ResultOf<typeof postWithTagsFragment>
// → { id: string; title: string; tags: { id: string; name: string }[] }
```

---

### Pattern F — deeply nested (three levels)

```typescript
const userFragment = defineFragment<User>()({ id: true, name: true } as const)
const postFragment = defineFragment<Post>()({
  id: true,
  title: true,
  author: userFragment,
} as const)
const commentFragment = defineFragment<Comment>()({
  id: true,
  body: true,
  post: postFragment,
  author: userFragment,
} as const)

type CommentData = ResultOf<typeof commentFragment>
// → {
//     id: string
//     body: string
//     post: { id: string; title: string; author: { id: string; name: string } | null } | null
//     author: { id: string; name: string } | null
//   }

const comments = await context.db.comment.findMany({ query: commentFragment })
```

---

### Pattern G — reusing the same fragment instance across multiple parent fragments

Fragments are plain objects and can be referenced freely:

```typescript
const userFragment = defineFragment<User>()({ id: true, name: true } as const)

// Reuse in multiple parents
const postFragment = defineFragment<Post>()({ id: true, author: userFragment } as const)
const commentFragment = defineFragment<Comment>()({ id: true, author: userFragment } as const)
```

---

### Pattern H — nested filtering with `RelationSelector`

Use `RelationSelector` to apply Prisma filter/ordering/pagination to a nested relationship within the same fragment:

```typescript
import type { Post, Comment } from '.prisma/client'
import { defineFragment, type ResultOf } from '@opensaas/stack-core'

const commentFragment = defineFragment<Comment>()({ id: true, body: true } as const)

const postWithRecentComments = defineFragment<Post>()({
  id: true,
  title: true,
  // RelationSelector: fragment + Prisma args for the nested relationship
  comments: {
    query: commentFragment,
    where: { approved: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  },
} as const)

type PostWithComments = ResultOf<typeof postWithRecentComments>
// → { id: string; title: string; comments: { id: string; body: string }[] }

const posts = await context.db.post.findMany({ query: postWithRecentComments })
```

### Pattern I — variables via factory function

When the nested filter needs a runtime value, use a factory function:

```typescript
function makePostFragment(status: string) {
  return defineFragment<Post>()({
    id: true,
    title: true,
    comments: {
      query: commentFragment,
      where: { status },
    },
  } as const)
}

// ResultOf works with the return type
type PostData = ResultOf<ReturnType<typeof makePostFragment>>

// Build the fragment at call-site with the runtime value
const posts = await context.db.post.findMany({
  query: makePostFragment('approved'),
  where: { published: true },
})
```

---

### Standalone helpers: `runQuery` / `runQueryOne`

For convenience, standalone functions are also available when you don't have direct access to `context.db` (e.g., in hook implementations or utility functions):

```typescript
import { runQuery, runQueryOne } from '@opensaas/stack-core'

// Equivalent to context.db.post.findMany({ query: postFragment, where, ... })
const posts = await runQuery(context, 'Post', postFragment, {
  where: { published: true },
  orderBy: { publishedAt: 'desc' },
})

// Equivalent to context.db.post.findUnique({ where: { id }, query: postFragment })
const post = await runQueryOne(context, 'Post', postFragment, { id: postId })
```

---

## 3. Access control — no changes needed

Access control functions in Keystone and OpenSaas Stack share the same shape:

```typescript
// Keystone
access: {
  operation: {
    query: ({ session }) => !!session,
  },
  filter: {
    query: ({ session }) => ({ author: { id: { equals: session?.itemId } } }),
  },
}

// OpenSaas Stack — identical shape for operation-level access
access: {
  operation: {
    query:  ({ session }) => !!session,
    update: ({ session, item }) => session?.userId === item.authorId,
  },
}
```

Filter-based access (returning a Prisma `where` object) is also compatible.

---

## 4. Hook migration

Most hooks map directly. The only new one is `resolveOutput` (for transforming read values).

| Keystone hook     | OpenSaas Stack equivalent                            |
| ----------------- | ---------------------------------------------------- |
| `resolveInput`    | `resolveInput` ✓                                     |
| `validateInput`   | `validate` (or `validateInput` for backwards compat) |
| `beforeOperation` | `beforeOperation` ✓                                  |
| `afterOperation`  | `afterOperation` ✓                                   |
| _(none)_          | `resolveOutput` (new — transforms read values)       |

### `validateInput` → `validate`

```typescript
// Keystone
hooks: {
  validateInput: ({ resolvedData, addValidationError }) => {
    if (!resolvedData.title) addValidationError('Title is required')
  },
}

// OpenSaas Stack — preferred name
hooks: {
  validate: ({ resolvedData, addValidationError }) => {
    if (!resolvedData.title) addValidationError('Title is required')
  },
}
// (validateInput still works for backwards compatibility)
```

---

## 5. Field type mapping

| Keystone field   | OpenSaas Stack field   |
| ---------------- | ---------------------- |
| `text()`         | `text()`               |
| `integer()`      | `integer()`            |
| `float()`        | `decimal()`            |
| `decimal()`      | `decimal()`            |
| `checkbox()`     | `checkbox()`           |
| `timestamp()`    | `timestamp()`          |
| `calendarDay()`  | `calendarDay()`        |
| `password()`     | `password()`           |
| `select()`       | `select()`             |
| `relationship()` | `relationship()`       |
| `json()`         | `json()`               |
| `virtual()`      | `virtual()`            |
| `image()`        | _(use storage config)_ |
| `file()`         | _(use storage config)_ |

---

## 6. Many-to-many join table naming (important for data preservation)

Keystone and Prisma use different implicit join-table naming conventions for M2M relationships. Without adjustment, running `prisma db push` on a migrated schema will **create new empty join tables** while your data remains in the old ones.

**Keystone convention:** `_<FieldLocation>_<fieldName>` (e.g. `_Post_tags`)
**Prisma default:** alphabetically sorted `_<AToB>` (e.g. `_PostToTag`)

Fix this in your config with `joinTableNaming`:

```typescript
export default config({
  db: {
    provider: 'postgresql',
    joinTableNaming: 'keystone',  // ← preserve Keystone table names
    prismaClientConstructor: ...,
  },
  // ...
})
```

Or per-relationship with `db.relationName`:

```typescript
tags: relationship({
  ref: 'Tag.posts',
  many: true,
  db: { relationName: 'Post_tags' },  // ← exact join table name
}),
```

---

## 7. Authentication

Replace `@keystone-6/auth` with `@opensaas/stack-auth`. The config shape changes but the concepts are the same.

```typescript
// Keystone
import { createAuth } from '@keystone-6/auth'
const { withAuth } = createAuth({
  listKey: 'User',
  identityField: 'email',
  secretField: 'password',
})

// OpenSaas Stack
import { authPlugin } from '@opensaas/stack-auth'
export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: true },
    }),
  ],
  // ...
})
```

See [`packages/auth/CLAUDE.md`](../packages/auth/CLAUDE.md) and [`examples/auth-demo`](../examples/auth-demo/) for full setup.

---

## 8. Checklist for migration agents

When automating a Keystone → OpenSaas Stack migration, work through this checklist in order:

1. **[ ] Install packages** — replace `@keystone-6/core` with `@opensaas/stack-core`, `@opensaas/stack-core/fields`, and (if auth) `@opensaas/stack-auth`.

2. **[ ] Convert `schema.ts` + `keystone.ts`** into a single `opensaas.config.ts` using the config structure above.

3. **[ ] Add `prismaClientConstructor`** to the `db` config block (Prisma 7 requirement).

4. **[ ] Run `pnpm generate`** to produce `prisma/schema.prisma`, `.opensaas/types.ts`, and `.opensaas/context.ts`.

5. **[ ] Check M2M join tables** — set `joinTableNaming: 'keystone'` or per-field `db.relationName` if the database has existing data.

6. **[ ] Run `pnpm db:push`** (or `prisma migrate dev`) and verify the schema diff shows no unintended new tables.

7. **[ ] Replace all `context.graphql.run` calls:**
   a. Identify each unique GraphQL query/fragment.
   b. Create a `defineFragment<T>()({...})` for each shape.
   c. Replace list queries with `context.db.<list>.findMany({ query: fragment, where?, orderBy?, take?, skip? })`.
   d. Replace single-record queries with `context.db.<list>.findUnique({ where: { id }, query: fragment })`.
   e. Replace `data.posts` (or similar) with the direct return value.
   f. Replace any codegen-generated types with `ResultOf<typeof fragment>`.
   g. For nested relationship filtering, use `RelationSelector` (`{ query, where, orderBy, take, skip }`) instead of separate queries.

8. **[ ] Migrate hooks** — rename `validateInput` → `validate` if desired (backwards-compat alias exists).

9. **[ ] Migrate auth** — replace `@keystone-6/auth` with `authPlugin` (see §7).

10. **[ ] Run `pnpm lint && pnpm format`** to fix code style.

11. **[ ] Run `pnpm test`** to verify correctness.

---

## 9. Quick reference — `context.graphql.run` → context.db with fragments

```typescript
// ── BEFORE (Keystone) ───────────────────────────────────────────────

// Define a type (usually via GraphQL codegen)
type PostData = { id: string; title: string; author: { id: string; name: string } | null }

// Run a query
const { data, errors } = await context.graphql.run<{ posts: PostData[] }>({
  query: `
    query GetPosts($where: PostWhereInput) {
      posts(where: $where) {
        id
        title
        author { id name }
      }
    }
  `,
  variables: { where: { published: { equals: true } } },
})
if (errors?.length) throw new Error(errors[0].message)
const posts = data.posts

// ── AFTER (OpenSaas Stack) ──────────────────────────────────────────

import type { User, Post } from '.prisma/client'
import { defineFragment, type ResultOf } from '@opensaas/stack-core'

// Declare fragments once, reuse everywhere
const authorFragment = defineFragment<User>()({ id: true, name: true } as const)
const postFragment = defineFragment<Post>()({
  id: true,
  title: true,
  author: authorFragment,
} as const)

// Types are inferred — no codegen step
type PostData = ResultOf<typeof postFragment>
// → { id: string; title: string; author: { id: string; name: string } | null }

// List query — access control is still enforced
const posts = await context.db.post.findMany({
  query: postFragment,
  where: { published: true },
})
// posts: PostData[]

// Single record
const post = await context.db.post.findUnique({
  where: { id: postId },
  query: postFragment,
})
// post: PostData | null

// Nested relationship filtering (RelationSelector)
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
const postsWithTopComments = await context.db.post.findMany({ query: postWithComments })
```
