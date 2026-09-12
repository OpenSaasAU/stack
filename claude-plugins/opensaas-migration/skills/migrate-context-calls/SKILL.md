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
| `context.query.Post.findMany(...)`          | `context.db.post.findMany(...)`     |
| `context.query.Post.count(...)`             | `context.db.post.count(...)`        |
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

### Nested / related data (composed read — recommended)

A read is composed on `context.db.<List>` and narrowed with `.select()`; relations are reached with `.include()`, which composes at every level. This is the native equivalent of Keystone's GraphQL fragments — no separate declaration, no codegen, and the result type comes straight from the generated list types.

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

// After — compose the read once, narrow with .select() / .include()
const posts = await context.db.Post.where({ published: { equals: true } })
  .select('id', 'title')
  .include('author', (author) => author.select('id', 'name'))
  .include('tags', (tags) => tags.select('id', 'name'))
  .orderBy({ publishedAt: 'desc' })
  .all()
// posts[0] is exactly { id, title, author: { id, name } | null, tags: { id, name }[] }
// plus the list's system fields — inferred, not declared
```

For single-record queries:

```typescript
const post = await context.db.Post.where({ id: { equals: postId } })
  .select('id', 'title')
  .include('author', (author) => author.select('id', 'name'))
  .first()
if (!post) return notFound()
```

For nested relationship filtering (e.g., only load approved comments):

```typescript
const postWithComments = await context.db.Post.where({ id: { equals: postId } })
  .select('id', 'title')
  .include('comments', (comments) =>
    comments
      .where({ approved: { equals: true } })
      .orderBy({ createdAt: 'desc' })
      .limit(5)
      .select('id', 'body'),
  )
  .first()
```

A reusable projection is an ordinary function that takes and returns the composed query — no bespoke fragment type to declare:

```typescript
import type { getContext } from '@/.opensaas/context'

type Db = Awaited<ReturnType<typeof getContext>>['db']

function withAuthorAndTags(query: Db['Post']) {
  return query
    .select('id', 'title')
    .include('author', (author) => author.select('id', 'name'))
    .include('tags', (tags) => tags.select('id', 'name'))
}

const withAuthor = await withAuthorAndTags(
  context.db.Post.where({ published: { equals: true } }),
).all()
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

## Recipe 1 — `where`-shape translation (relation filters → scalar-FK / relation filters)

Keystone's GraphQL `where` nests through the related list even when you are filtering on a foreign key (`{ author: { id: { equals: $id } } }`). Prisma exposes the scalar foreign key directly (`{ authorId: { equals: $id } }`), so the most common rewrite is to **collapse a single-relation `{ id: { equals } }` filter onto the scalar `*Id` field**. Filtering on _other_ fields of the related record stays nested (Prisma calls this a relation filter), and to-many relations use `some` / `every` / `none`.

```typescript
// Before — Keystone relation filter on the related record's id
const { posts } = await context.graphql.run({
  query: `query GetPosts($authorId: ID!) {
    posts(where: {
      author: { id: { equals: $authorId } }
      status: { in: [published, featured] }
      tags: { some: { name: { equals: "release" } } }
    }) { id title }
  }`,
  variables: { authorId },
})

// After — collapse the FK relation filter to the scalar field; keep genuine
// relation filters nested; to-many uses some/every/none
const posts = await context.db.post.findMany({
  where: {
    authorId: { equals: authorId }, // author.id → authorId scalar FK
    status: { in: ['published', 'featured'] }, // enum string values, not GraphQL idents
    tags: { some: { name: { equals: 'release' } } }, // to-many relation filter kept nested
  },
})
```

### Translation table

| Keystone `where`                                       | Prisma `where`                                       | Notes                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `{ author: { id: { equals: $id } } }`                  | `{ authorId: { equals: $id } }`                      | Single relation filtered by `id` → collapse onto scalar FK `<field>Id`.         |
| `{ author: { id: { equals: $id } } }`                  | `{ authorId: $id }`                                  | Prisma allows the bare value as shorthand for `{ equals: $id }`.                |
| `{ author: { name: { contains: "x" } } }`              | `{ author: { name: { contains: "x" } } }`            | Filtering a _non-id_ field of a single relation stays a nested relation filter. |
| `{ author: null }`                                     | `{ authorId: null }` (or `{ author: { is: null } }`) | "No related record" → null scalar FK; `is: null` also works.                    |
| `{ tags: { some: { name: { equals: "x" } } } }`        | `{ tags: { some: { name: { equals: "x" } } } }`      | To-many: `some` unchanged.                                                      |
| `{ tags: { every: { archived: { equals: false } } } }` | `{ tags: { every: { archived: false } } }`           | To-many: `every` unchanged.                                                     |
| `{ tags: { none: { name: { equals: "x" } } } }`        | `{ tags: { none: { name: { equals: "x" } } } }`      | To-many: `none` unchanged.                                                      |
| `{ AND: [...] }` / `{ OR: [...] }` / `{ NOT: ... }`    | `{ AND: [...] }` / `{ OR: [...] }` / `{ NOT: ... }`  | Logical operators are identical.                                                |

**Scalar operators** map almost 1:1 — the main difference is Keystone wraps even simple equality in `{ equals }`, while Prisma accepts the bare value:

| Keystone scalar filter                                                      | Prisma scalar filter                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `{ status: { equals: published } }`                                         | `{ status: 'published' }` or `{ status: { equals: 'published' } }` (enum → string literal) |
| `{ title: { not: { equals: "x" } } }`                                       | `{ title: { not: 'x' } }`                                                                  |
| `{ views: { gt: 10, lte: 100 } }`                                           | `{ views: { gt: 10, lte: 100 } }`                                                          |
| `{ id: { in: [a, b] } }` / `{ notIn: [...] }`                               | `{ id: { in: [a, b] } }` / `{ id: { notIn: [...] } }`                                      |
| `{ title: { contains: "x" } }`                                              | `{ title: { contains: 'x' } }`                                                             |
| `{ title: { startsWith / endsWith: "x" } }`                                 | `{ title: { startsWith / endsWith: 'x' } }`                                                |
| `{ title: { mode: insensitive, contains } }` (Keystone field `_i` variants) | `{ title: { contains: 'x', mode: 'insensitive' } }`                                        |

> **Enum gotcha:** Keystone GraphQL writes enum values as bare identifiers (`status: published`). Prisma/`context.db` uses **string literals** (`status: 'published'`). Always quote them in the rewrite.

## Recipe 2 — `connect` / `disconnect` / `set` nested writes

Keystone relationship mutations use nested-write operators inside `data`. Prisma uses the same _names_ but the shapes differ slightly, and OpenSaaS Stack passes `data` straight through to Prisma — so use Prisma's relation-operation shapes. Field-level access control still filters writable fields, and the foreign-key column is never written directly (use the relation field, not `authorId`).

```typescript
// Before — Keystone create with a connected author and connected tags
const { createPost } = await context.graphql.run({
  query: `mutation CreatePost($data: PostCreateInput!) {
    createPost(data: $data) { id }
  }`,
  variables: {
    data: {
      title: 'Hello',
      author: { connect: { id: authorId } },
      tags: { connect: [{ id: tagA }, { id: tagB }] },
    },
  },
})

// After — Prisma relation operations on create (note: connect-many takes an array)
const post = await context.db.post.create({
  data: {
    title: 'Hello',
    author: { connect: { id: authorId } },
    tags: { connect: [{ id: tagA }, { id: tagB }] },
  },
})
```

```typescript
// Before — Keystone update: swap author, add/remove tags
await context.graphql.run({
  query: `mutation UpdatePost($id: ID!, $data: PostUpdateInput!) {
    updatePost(where: { id: $id }, data: $data) { id }
  }`,
  variables: {
    id: postId,
    data: {
      author: { connect: { id: newAuthorId } }, // reassign single relation
      tags: {
        connect: [{ id: tagC }], // add
        disconnect: [{ id: tagA }], // remove
      },
    },
  },
})

// After — Prisma update relation operations
const updated = await context.db.post.update({
  where: { id: postId },
  data: {
    author: { connect: { id: newAuthorId } },
    tags: {
      connect: [{ id: tagC }],
      disconnect: [{ id: tagA }],
    },
  },
})
if (!updated) {
  /* access denied or not found — context.db returns null, never throws */
}
```

### Nested-write translation table

| Keystone nested write               | Prisma nested write                 | Applies to                                    |
| ----------------------------------- | ----------------------------------- | --------------------------------------------- |
| `author: { connect: { id } }`       | `author: { connect: { id } }`       | create / update                               |
| `author: { disconnect: true }`      | `author: { disconnect: true }`      | update (nullable single relation)             |
| `tags: { connect: [{ id }, …] }`    | `tags: { connect: [{ id }, …] }`    | create / update (to-many)                     |
| `tags: { disconnect: [{ id }, …] }` | `tags: { disconnect: [{ id }, …] }` | update (to-many)                              |
| `tags: { set: [{ id }, …] }`        | `tags: { set: [{ id }, …] }`        | update (to-many — **replaces** the whole set) |
| `tags: { set: [] }`                 | `tags: { set: [] }`                 | update (clear all to-many links)              |
| `author: { create: { … } }`         | `author: { create: { … } }`         | create / update (nested create)               |

> **`set` replaces, `connect` adds.** On a to-many relation, Keystone's `set: [...]` and Prisma's `set: [...]` both _replace_ the entire list of links; `connect` only adds. To clear all links use `set: []`.
>
> **Never write the scalar FK directly.** Use the relation field (`author: { connect: { id } }`), not `authorId: …`. `filterWritableFields` strips `<field>Id` keys when a relationship field exists, so writing the FK directly is silently dropped.

## Recipe 3 — gql.tada typed documents → a composed read

gql.tada projects build typed documents (`TadaDocumentNode`) and derive types with `ResultOf` / `VariablesOf` from the GraphQL schema. OpenSaaS Stack has no GraphQL schema (ADR-0005): replace the typed _document_ with a composed read narrowed by `.select()` / `.include()`, and read the row type straight off the generated list types — there is no bespoke `ResultOf` to derive it from. `VariablesOf` becomes plain function parameters / `where` arguments — there is no document to parameterise.

```typescript
// Before — gql.tada typed document + ResultOf / VariablesOf
import { graphql, type ResultOf, type VariablesOf } from 'gql.tada'

const PostsQuery = graphql(`
  query GetPosts($authorId: ID!) {
    posts(where: { author: { id: { equals: $authorId } } }) {
      id
      title
      author {
        id
        name
      }
    }
  }
`)

type PostsResult = ResultOf<typeof PostsQuery> // { posts: { id; title; author: { id; name } | null }[] }
type PostsVars = VariablesOf<typeof PostsQuery> // { authorId: string }

async function getPosts(vars: PostsVars) {
  const { posts } = await context.graphql.run({ query: PostsQuery, variables: vars })
  return posts
}
```

```typescript
// After — a composed read, typed by inference (no GraphQL schema, no codegen)
function getPosts(authorId: string) {
  return context.db.Post.where({ authorId: { equals: authorId } }) // relation filter collapsed (see Recipe 1)
    .select('id', 'title')
    .include('author', (author) => author.select('id', 'name'))
    .all()
}

// The row type comes off a real call, not a bespoke ResultOf utility
type PostData = Awaited<ReturnType<typeof getPosts>>[number]
// → { id: string; title: string; author: { id: string; name: string } | null }
```

**Mapping summary:**

| gql.tada                                         | OpenSaaS Stack                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `graphql('query … { … }')` (`TadaDocumentNode`)  | `context.db.<List>.where(…).select(…).include(…)` — a composed read, no separate declaration   |
| `ResultOf<typeof Doc>`                           | `Awaited<ReturnType<typeof fn>>[number]` off a real call, or the generated list types directly |
| `VariablesOf<typeof Doc>`                        | Plain function parameters → `where` / `orderBy` / `limit` args                                 |
| `context.graphql.run({ query: Doc, variables })` | `context.db.<List>.where(…).select(…).all()` / `.first()`                                      |
| `.graphql` codegen of fragment files             | A shared file of ordinary functions, each returning a composed query value                     |

When the old document parameterised a **nested** relationship filter, the composed read takes the parameter directly — there is no separate factory step:

```typescript
function postsWithComments(commentStatus: string) {
  return context.db.Post.select('id', 'title').include('comments', (comments) =>
    comments.where({ status: { equals: commentStatus } }).select('id', 'body'),
  )
}

const posts = await postsWithComments('approved').all()
```

## Recipe 4 — nested reads: `.select()` / `.include()` + null-on-access-denied

`.select()` and `.include()` compose directly on the read itself, and the access-control layer applies on top:

- **Scalar fields** are named in `.select('id', 'title', …)`. It replaces any previous call rather than accumulating, and it narrows only this list's own columns — it leaves any relation already reached with `.include()` on the row.
- **Relationship fields** are reached with `.include(name, refine?)`, recursively: the refine callback receives the related list's own composed-read interface, so `.where()`, `.orderBy()`, `.limit()` and further `.select()` / `.include()` calls nest through it.

```typescript
const post = await context.db.Post.where({ id: { equals: postId } })
  .select('id', 'title')
  .include('author', (author) => author.select('id', 'name'))
  .include('comments', (comments) =>
    comments
      .where({ approved: { equals: true } })
      .orderBy({ createdAt: 'desc' })
      .limit(5)
      .select('id', 'body'),
  )
  .first()
```

This is the same shape Prisma itself runs under an equivalent `include` / `select` — the access filter rides in on top of it, and only what `.select()` named comes back.

### Null-on-access-denied semantics for nested relations

Access control runs at **every level**, and denial is silent (no throw):

- **Top-level single read** (`.first()`): returns `null` when the operation-level `query` access denies, the access filter excludes the row, or the row does not exist. Always `if (!post) …`.
- **Top-level list read** (`.all()`): returns `[]` on denial; individual rows the access filter excludes are simply absent from the array.
- **Nested single relation** (`author`): if the related record is filtered out by its list's access control (or the FK is null), the field comes back as `null` — even though the parent row was returned. Every to-one read off an included row is `T | null` by arity alone, whatever the underlying column's nullability says (ADR-0058):

  ```typescript
  const post = await context.db.Post.where({ id: { equals: postId } })
    .select('id', 'title')
    .include('author', (author) => author.select('id', 'name'))
    .first()
  if (!post) return notFound()
  const authorName = post.author?.name ?? 'Unknown' // guard the nested null
  ```

- **Nested to-many relation** (`comments`): records the nested list's access control excludes are dropped from the array — you get a (possibly empty) array, never `null`, for a to-many field.
- **Field-level access**: a denied _field_ is stripped from the row before it is returned; naming it in `.select()` does not surface it.

> **Migration takeaway:** Keystone fragments resolved nested data through the GraphQL layer's own access checks and returned `null` for denied relations. `context.db` reproduces the same null-on-access-denied behaviour through `.select()` / `.include()` — so keep your Keystone null-guards (`post.author?.name`) when porting fragment consumers; they are still required.

## Steps

1. Use Grep to find all occurrences of `context.graphql`, `context.query`, and `context.sudo().graphql` in the project (search `.ts`, `.tsx` files, exclude `node_modules`)
2. For each occurrence:
   a. Read the file to understand the full query/mutation
   b. Identify the operation type:
   - **Read with nested data** → prefer a composed read narrowed with `.select()` / `.include()` (see pattern above)
   - **Simple read** → `context.db.{list}.findMany()` / `findUnique()`
   - **Create / update / delete** → `context.db.{list}.create()` / `update()` / `delete()`
   - **Count** → `context.db.{list}.count()`
     c. Identify the list name (convert to camelCase for `context.db`)
     d. Rewrite using the appropriate pattern above. Apply the relevant recipe:
   - **`where` clauses** → translate relation/scalar filters with **Recipe 1** (collapse `{ author: { id: { equals } } }` → `{ authorId: { equals } }`, quote enum values).
   - **`connect` / `disconnect` / `set` in `data`** → keep Prisma's relation-operation shapes with **Recipe 2**; never write the scalar FK directly.
   - **gql.tada typed documents** (`graphql(...)`, `ResultOf`, `VariablesOf`) → replace with a composed read narrowed by `.select()` / `.include()` per **Recipe 3**.
   - **Nested reads** → map to `.select()` / `.include()` and keep null-guards per **Recipe 4**.
     e. For reused nested-read shapes: create a shared file of ordinary functions returning composed query values, and import from it
3. After all edits: check that any `import ... from '@keystone-6/core'` imports used only for graphql types are removed or reduced; also remove any GraphQL codegen type imports (replace with the generated list types, inferred from the composed read); for gql.tada surfaces, remove `import { graphql, ResultOf, VariablesOf } from 'gql.tada'`
4. Report: list every file changed and summarise what was replaced
