# Access Control

The access-control engine is why Stack exists. Application code — yours or your AI agent's — never talks to the database directly; it talks to a secured context, and the engine applies your access rules to **every** query, create, update, and delete. Security stops being a property of each handler someone remembered to write and becomes a property of the framework: the secure path is the only path.

## Overview

Every operation goes through the context wrapper, and every context operation passes access control before anything is returned.

Reads are composed on `context.db.<List>`, keyed by the **PascalCase list name**
the config uses, and reach the database only through a terminal:

```typescript
const posts = await context.db.Post.where({ status: { equals: 'published' } }).all()
```

There is no unscoped sibling of that call to reach for by accident. The
deliberate bypass — `context.unsafe` — is a different name on a different
object, and every use of it is meant to say why.

Two defaults set the tone:

- **Deny by default.** A list with no access rules isn't open — it's inaccessible. Nothing ships readable by accident.
- **Silent failure.** A denied operation returns `null` (single record) or `[]` (many), indistinguishable from "not found" — so callers can't probe for records they aren't allowed to see.

## How It Works

Writes check operation-level access, filter writable fields, then persist. Reads are a **two-phase** pipeline:

1. **Access Filter** (pre-query): the engine evaluates operation-level `query` access and ANDs the resulting filter into the read's own `where` and into each `include` — rows and relations a session can't see never leave the database. This only runs for relations the caller actually asked for, one hop at a time: a read with no `include` fetches the row's own columns and computed fields only, matching the ORM's own semantics, and naming a relation fetches that relation's own columns and stops — reaching further means naming further. A relation nobody named never has its list's `query` access evaluated at all. See [Queries & projections](/docs/concepts/queries).
2. **Field Visibility** (post-query): on the returned rows, fields the session can't read are removed, `resolveOutput` hooks run, and virtual fields are computed.

In order:

1. **Define access rules** in your `opensaas.config.ts`
2. **Operations go through context**: `context.db.Post.update({ where, data })`
3. **Access control engine checks** operation-level access
4. **Access filters are ANDed** into the read's `where`
5. **Field-level access** controls which fields are readable/writable
6. **Operations return** `null` or `[]` on access denial (silent failures)

## Access Control Types

### Operation-Level Access

Controls whether a user can perform an operation at all:

Each slot takes a **function**, not a literal — `query: true` is a compile
error, `query: () => true` is the rule that always allows:

```typescript
Post: list({
  fields: { title: text() },
  access: {
    operation: {
      query: () => true,
      create: ({ session }) => !!session?.userId,
      update: isAuthor,
      delete: isAdmin,
    },
  },
})
```

A rule returns one of two things, synchronously or as a `Promise`:

- **A boolean** — `true` allows the operation, `false` denies it outright.
- **A filter** — the operation proceeds, scoped to the rows the filter matches.

`create` is the exception: it accepts a **boolean result only**. There is no
existing row for a filter to scope, so a `create` rule that returns one throws
`InvalidCreateAccessResultError` rather than being read as an allow. To gate a
create on the incoming data, evaluate the condition in a `resolveInput` or
`validate` [hook](/docs/concepts/hooks), where the input is in scope.

### Scoping by returning a filter

A rule scopes a read by **returning** a filter. There is no separate
`access: { filter }` block, and no list-level `access: { fields }` — a list's
`access` is either one function applied to all four operations, or an object
whose only member is `operation`.

```typescript
query: ({ session }) => {
  if (!session?.userId) {
    return { status: { equals: 'published' } }
  }

  return {
    OR: [{ status: { equals: 'published' } }, { authorId: { equals: session.userId } }],
  }
}
```

The returned filter is ANDed into whatever `where` the caller composed, so a
session never widens its own scope by asking for more.

### The filter vocabulary is a closed set

A returned filter is written in the same grammar as `.where()`, and that grammar
is finite. Scalar operators: `equals`, `not`, `in`, `notIn`, `lt`, `lte`, `gt`,
`gte`, `contains`. Relation quantifiers: `some`, `every`, `none`. Logical keys:
`AND`, `OR`, `NOT`. A bare value means equality; `contains` is case-insensitive.
There is no `startsWith`, no `endsWith`, no `mode`, and no `is`/`isNot` — naming
one is refused, not ignored.

{% callout type="warning" %}
**`undefined` is refused, never dropped.** A filter value of `undefined` raises
a `ValidationError` instead of quietly vanishing from the predicate. This is the
fail-closed rule that matters most in an access rule: the tempting shorthand

```typescript
query: ({ session }) => ({ authorId: { equals: session?.userId } })
```

is an **error** for an anonymous session, not an unfiltered read of every post.
Branch on the session and return a real predicate — or `false` — for the
anonymous case, as the example above does.
{% /callout %}

### Field-Level Access

Control access to individual fields:

```typescript
fields: {
  internalNotes: text({
    access: {
      read: ({ session, item }) => session?.userId === item.authorId,
      create: ({ session }) => !!session?.userId,
      update: ({ session, item }) => session?.userId === item.authorId,
    },
  }),
  secret: password({
    access: {
      read: () => false,
    },
  }),
}
```

{% callout type="warning" %}
**Field-level rules are boolean-only, and are still functions.** `read: false`
is a compile error; `read: () => false` is the rule. An operation-level rule may
return a filter to scope rows; a field-level rule decides allow/deny for one
field, from `session`, the fetched `item` and — on `create`/`update` — the
`inputData`. A field rule that somehow returns a non-boolean throws rather than
defaulting to allow, so filter-returning helpers cannot be reused here.
{% /callout %}

## Access Functions

An operation-level rule is called with exactly three arguments. `session` is the
app's session or `null`. `item` is the existing row — present for `update` and
`delete`, absent for `query` and `create`, which is why its type is optional.
`context` is the `AccessContext`, carrying `session`, `db`, `plugins` and
`storage`.

```typescript
import type { AccessControl } from '@opensaas/stack-core'

const rule: AccessControl = ({ session, item, context }) => {
  return !!session
}
```

The list key and the operation are not passed in: a rule is already registered
against one list under one slot, so both are known where you wrote it. A rule
that genuinely needs to serve several slots is an ordinary function you name in
each of them.

### Common Patterns

**Check if user is signed in:**

```typescript
const isSignedIn: AccessControl = ({ session }) => !!session?.userId
```

**Check if user is the author:**

```typescript
const isAuthor: AccessControl = ({ session, item }) => {
  if (!session?.userId) return false
  return item?.authorId === session.userId
}
```

**Check if user has a role:**

```typescript
const isAdmin: AccessControl = ({ session }) => {
  return session?.role === 'admin'
}
```

**Complex filter combining multiple conditions.** The `authorId` branch only
exists when there is a user id to compare against — an `undefined` there would
be refused, not skipped:

```typescript
const visibleToSession: AccessControl = ({ session }) => {
  const published = {
    AND: [
      { status: { equals: 'published' } },
      { visibility: { equals: 'public' } },
      { publishedAt: { lte: new Date() } },
    ],
  }

  const userId = session?.userId
  if (typeof userId !== 'string') return published

  return { OR: [published, { authorId: { equals: userId } }] }
}
```

## Silent Failures

Stack returns `null` (for single records) or `[]` (for multiple records) when access is denied, rather than throwing errors. This prevents information leakage about whether records exist. There is no `AccessDeniedError` to catch: a denial is not an exception, it is an empty answer.

Every access-controlled read and write is therefore nullable at the call site. `.first()`, `create`, `update` and `delete` all return `T | null`, and `.aggregate()` answers `0` under every key. Check before you dereference:

```typescript
const post = await context.db.Post.where({ id: { equals: postId } }).first()

if (!post) {
  return { error: 'Post not found' }
}
```

`null` here means the post does not exist **or** this session may not see it, and the caller cannot tell which. That conflation is the point.

**Why silent failures?**

- Prevents information leakage
- Consistent API (no try/catch needed)
- Simpler application code
- Better security by default

## Nested `include` depth limit

The Access Filter — the pass that scopes relation `include`s before the database is queried — only scopes an `include` up to a fixed nesting depth (`READ_INCLUDE_MAX_DEPTH`, currently 5 hops from the list you queried). This is a cost limit, not an inability to scope: since the walk only ever follows branches a request itself names, there is no unscoped subtree to fail open on past the cap. If a caller-supplied `include` names a relation nested **past** that depth, the engine declines to serve a tree this expensive rather than serving it anyway, so it throws `AccessScopeDepthExceededError`:

The error carries `listKey`, `fieldKey` and `depth`, which together name the hop that went too deep. The remedy is to split the read into separate, shallower ones:

```typescript
import { AccessScopeDepthExceededError } from '@opensaas/stack-core'

try {
  await context.db.Post.include('author', (author) =>
    author.include('organisation', (org) => org.include('owner')),
  ).all()
} catch (error) {
  if (error instanceof AccessScopeDepthExceededError) {
    console.error(`include too deep at ${error.listKey}.${error.fieldKey} (${error.depth})`)
  }
  throw error
}
```

This only affects a caller-supplied `include` that explicitly reaches past the cap. An ordinary read with no `include` — or one that stays within the limit — is unaffected: the cap never turns a normal, shallow read into an error, and a schema deeper than the cap is still perfectly readable one hop at a time. See ADR-0022 for the full rationale.

## System Fields

`id` is the only column the generator adds on its own. `createdAt`/`updatedAt`
are **off by default** ([ADR-0004](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0004-generator-emits-keystone-compatible-defaults.md)):
a list opts in by declaring the two fields itself or by setting
`db: { timestamps: true }`, per list or on `db` for every list at once.

All three names, where the list has them, are:

- Excluded from access control (always readable)
- Excluded from field-level write operations

You cannot override access control for system fields.

## `connect` is gated by the owning relationship field's access

Relation input on the side that owns the foreign key is `{ connect: { id } }`,
or `null` to clear the edge. Those are the only two shapes: there is no
`disconnect`, and nested `create`/`update`/`delete`/`connectOrCreate`/`set`/
`updateMany`/`deleteMany` are refused. A write is one list's row.

A `connect` is gated by the **owning relationship field's create/update
field-level access** (e.g. the `access` on `Post.author`), evaluated for the
enclosing write's operation. If that field's field-level access denies the
write, the connect is denied — exactly as for any other field on the write. This
gate receives the same `item` (the row being updated) and `inputData` (the write
payload) the parent write's field-access check uses, so a rule that depends on
either evaluates identically wherever the field is enforced.

For context, the connect is **also** gated by **read/query access on the target
list** (evaluated against the database): the caller must be able to _read_ the row
to connect it, because a connect references an existing row but does not modify its
data, so it requires read access on the target, not `update`. Both checks must pass
for a connect to succeed.

Below, `Author` defines a permissive `update` but no `query` rule, so its read
access is deny-by-default:

```typescript
lists: {
  Author: list({
    fields: { name: text() },
    access: {
      operation: {
        update: () => true,
      },
    },
  }),
  Post: list({
    fields: {
      title: text(),
      author: relationship({ ref: 'Author' }),
    },
    access: { operation: { query: () => true, update: () => true } },
  }),
}
```

The connect below is therefore **denied**, and the whole write answers `null`
— one indistinguishable answer, whether the author row is missing or merely
unreadable:

```typescript
const post = await context.db.Post.update({
  where: { id: postId },
  data: { author: { connect: { id: authorId } } },
})
```

`where` on a write is identity-only: exactly one key, `id`. A secondary unique
column is a compile error, so a write can never target a row by a value the
caller happens to know.

> **Behaviour change / migration note.** Because the access engine is
> **deny-by-default** for an undefined access rule, a related list that defines a
> permissive `update` but leaves `query` **undefined** now **denies** nested
> `connect` (previously such connects were allowed). This is the correct,
> read-gated direction and is consistent with how normal reads of that list
> already behave (they return empty). If you rely on connecting to such a list,
> **define a `query` rule** that permits the connect (for example a permissive
> `query: () => true` or a scoped filter). `sudo` bypasses the check entirely.

## Nested relation input is refused, not gated

A write payload holds one list's own scalars and its owned foreign keys. Every
nested spelling on a relationship field — `create`, `update`, `delete`,
`connectOrCreate`, `disconnect`, `set`, `updateMany` and `deleteMany` — is
refused with `NestedRelationInputError`. The generated input types make each a
compile error; the refusal is the runtime half, for a payload that reached the
engine untyped (a server action's form data, an MCP tool call, a plugin) or one
a `resolveInput` hook assembled after the types had their say.

The refusal is **unconditional**: unlike an access denial, `sudo()` does not
lift it. Each of these was a second write against another list hidden inside
one call — N hook chains staged against one atomic decision — so there is no
elevated caller for whom the shape becomes safe.

```typescript
import { NestedRelationInputError } from '@opensaas/stack-core'

try {
  await context.db.Post.update({
    where: { id },
    data: { tags: { deleteMany: {} } },
  })
} catch (err) {
  if (err instanceof NestedRelationInputError) {
    // err.listName / err.fieldKey / err.kinds identify the refused write.
  }
}
```

Write the related rows against their own list, wrapped in
`context.transaction()` when they must land together. To clear an edge, assign
`null` to the relationship field **that owns the foreign key** — the
replacement for `disconnect`. That is a foreign-key column on the row being
written, so it carries the enclosing write's own operation and field-level
access and names no target row to gate.

`null` is only ever that column's own spelling, so it goes where the column is.
On a field that owns no foreign key — a to-many, the non-owning half of a
one-to-one, a synthetic back-relation — `null` is refused with
`NonOwningRelationInputError` exactly as `connect` is. Clearing such an edge is
an update against the **target** list, assigning `null` to the field there that
owns the column:

```typescript
// Not `Author.posts`, which owns no column:
await context.db.Post.update({ where: { id: postId }, data: { author: null } })
```

## Access Control Execution Order

For **write operations** (create/update):

1. List-level operation access check
2. Field-level write access check (filter writable fields)
3. Hook execution (`resolveInput`, `validate`, …)
4. Database operation
5. Field-level read access check (filter readable fields in response)

For **read operations** (query):

1. List-level operation access check
2. AND the returned access filter into the read's `where`
3. Database operation
4. Field-level read access check (filter readable fields in response)

## Best Practices

### 1. Default to Restrictive

Start with restrictive access and open up as needed:

```typescript
access: {
  operation: {
    query: isSignedIn,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
}
```

### 2. Use Named Functions

Extract access functions for reusability:

```typescript
const isAuthor: AccessControl = ({ session, item }) => {
  return session?.userId === item?.authorId
}

const isAdminOrAuthor: AccessControl = (args) => {
  if (args.session?.role === 'admin') return true
  return isAuthor(args)
}
```

Forward the whole argument object rather than picking fields out of it: a rule
that reconstructs `{ session, item }` by hand drops `context`, and stops
compiling the moment it needs it.

### 3. Always Check for Session

Guard against null sessions:

```typescript
update: ({ session, item }) => {
  if (!session?.userId) return false
  return item?.authorId === session.userId
}
```

### 4. Test Access Control

Always test your access rules with different user scenarios:

- Anonymous users
- Authenticated users
- Authors vs non-authors
- Admin vs regular users

## Advanced Patterns

### Conditional Field Access

Fields can have different access rules based on context:

Admins read every address; everyone else reads only their own:

```typescript
email: text({
  access: {
    read: ({ session, item }) => {
      if (session?.role === 'admin') return true
      return session?.userId === item.id
    },
  },
})
```

### Cross-List Access Checks

A rule can read another list through `context.db`. That read is itself access
controlled, so it answers `null` when the session cannot see the membership row
— which is the same answer as "there is no such membership", and the right one
either way. Guard the session first so no filter value can be `undefined`:

```typescript
const isOrgAdmin: AccessControl<{ orgId: string }> = async ({ session, item, context }) => {
  const userId = session?.userId
  if (typeof userId !== 'string' || item === undefined) return false

  const membership = await context.db.OrgMembership.where({
    userId: { equals: userId },
    orgId: { equals: item.orgId },
    role: { equals: 'admin' },
  }).first()

  return membership !== null
}
```

### Time-Based Access

Editable for the first 24 hours, and by the author alone:

```typescript
const isRecentAndMine: AccessControl<{ authorId: string; createdAt: Date }> = ({
  session,
  item,
}) => {
  if (item === undefined) return false
  const dayInMs = 24 * 60 * 60 * 1000
  const isRecent = Date.now() - item.createdAt.getTime() < dayInMs

  return session?.userId === item.authorId && isRecent
}
```

## Common Pitfalls

### Forgetting to Check Session

Dereferencing a null session throws inside the rule, which fails the whole
operation rather than denying it. Guard first, and return `false`:

```typescript
update: ({ session, item }) => {
  if (!session?.userId || item === undefined) return false
  return item.authorId === session.userId
}
```

### Building a Filter Out of an Optional

The single most expensive mistake on this page. `session?.userId` is
`string | undefined`, and `undefined` in a filter is a `ValidationError` — so
this rule does not "match nothing" for an anonymous caller, it fails the read:

```typescript
query: ({ session }) => ({ authorId: { equals: session?.userId } })
```

Narrow to a value the vocabulary accepts, and decide explicitly what the
anonymous case should see:

```typescript
query: ({ session }) => {
  const userId = session?.userId
  if (typeof userId !== 'string') return { status: { equals: 'published' } }
  return { authorId: { equals: userId } }
}
```

### Over-Permissive Defaults

`create: () => true` lets anyone write. Spell out who may:

```typescript
access: {
  operation: {
    query: () => true,
    create: isSignedIn,
  },
}
```

### Not Testing Access Denial

Always test that access is denied when it should be. A non-author's update
resolves to `null` rather than throwing, so a test that only checks for an
absence of exceptions passes against a broken rule:

```typescript
const post = await context.db.Post.update({
  where: { id: postId },
  data: { title: 'New Title' },
})

expect(post).toBe(null)
```

## Next Steps

- **[Hooks System](/docs/concepts/hooks)** - Add data transformation
- **[Field Types](/docs/concepts/field-types)** - Explore field options
- **[Context API](/docs/reference/context-api)** - Full context reference
- **[Anonymous & Pre-Account Access](/docs/how-to/anonymous-access-control)** - Keep pre-account and anonymous flows on the access-scoped context instead of `sudo()`
