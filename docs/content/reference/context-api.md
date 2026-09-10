# Context API Reference

The context is the runtime interface to your data. It carries two surfaces, and the difference between them is the whole point of the page:

- **`context.db`** — the **secured surface**. Access control, Field Visibility, hooks, validation and error normalisation all apply. This is what application code uses.
- **`context.unsafe`** — the **Unsafe surface**. None of that applies. It is the documented escape hatch, named so that reaching for it is a visible act.

Everything else on the context (`sudo()`, `withSession()`, `transaction()`, `storage`) derives or supports one of those two.

{% callout type="info" %}
For the ideas behind the read surface — projection, computed fields, what a `resolveOutput` hook sees — read [Queries & projections](/docs/concepts/queries) first. This page describes the API.
{% /callout %}

## Getting a context

`opensaas generate` writes `.opensaas/context.ts`. It exports exactly three names, and applications use it rather than constructing a context by hand.

```typescript
import { getContext, rawOpensaasContext, config } from '@/.opensaas/context'
```

| Export                           | Type                         | Use                                                                                                           |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `getContext<TSession>(session?)` | `Promise<Context<TSession>>` | The normal door. `await` it per request.                                                                      |
| `rawOpensaasContext`             | `Promise<Context>`           | For module-init-time consumers that cannot `await`. Pass the promise itself; do not await it at module scope. |
| `config`                         | `Promise<OpenSaasConfig>`    | The resolved config, with the emitted tables attached. The generator emits `export const config = getConfig()` and `getConfig` is `async`, so this is a **promise** — `await` it, or pass `config={await config}` from a server component. |

```typescript
import { getContext } from '@/.opensaas/context'

const anonymous = await getContext()
const authenticated = await getContext({ userId: 'user-123' })
```

The ORM client behind it is a process singleton, built once from the committed `prisma/contract.json` artifact. Nothing that merely loads the config opens a connection.

### Module-init-time consumers

A library whose constructor runs at import time — Better-auth's adapter is the standing example — cannot `await`. Pass `rawOpensaasContext` itself to a helper that defers construction behind a lazy proxy:

```typescript
import { createAuth } from '@opensaas/stack-auth/server'
import { rawOpensaasContext } from '@/.opensaas/context'
import config from '../opensaas.config'

export const auth = createAuth(config, rawOpensaasContext)
```

### Building a second client synchronously

A third-party contract that must be handed a resolved client value at import time cannot use the proxy above. Build one the same way the generated context does — `resolveRuntimeConnection` plus the committed contract artifact — rather than hand-rolling a connection.

The generated `config` is a promise, so it cannot supply `db.client` here. Factor the client config into a plain module that both `opensaas.config.ts` and this consumer import, and there is nothing to await:

```typescript
// lib/db-client.ts — no config or plugin imports, safe to import synchronously
import type { DatabaseClientConfig } from '@opensaas/stack-core'

export const dbClient: DatabaseClientConfig = {
  /* pg: () => new Pool({ connectionString: process.env.DATABASE_URL }) */
}
```

```typescript
// opensaas.config.ts
import { dbClient } from './lib/db-client'

export default config({
  db: { client: dbClient },
  // …
})
```

```typescript
// lib/second-client.ts
import { resolveRuntimeConnection } from '@opensaas/stack-core/client'
import postgres from '@prisma/orm-postgres/runtime'
import type { Contract } from '../prisma/contract.d.js'
import contractJson from '../prisma/contract.json' with { type: 'json' }
import { dbClient } from './db-client'

export const secondClient = postgres<Contract>({
  contractJson,
  ...resolveRuntimeConnection(dbClient),
})
```

`resolveRuntimeConnection` is where [`db.client.pg`](/docs/reference/config-api) is consumed: it calls the factory when one is configured and otherwise resolves the connection URL itself. Its argument is optional, so an app that configures no `db.client` can call it with none. Two things about the result are deliberate and must be said wherever this pattern is reused. It is a **second connection**, separate from the framework's singleton. And it is the **raw client** — it carries none of `context.db`'s access control, Field Visibility or hooks.

## The context object

| Property               | Type                | Notes                                                                                     |
| ---------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `db`                   | the secured surface | One entry per list, keyed by the **list key** — `context.db.Post`, not `context.db.post`. |
| `session`              | `S \| null`         | Whatever your app puts there. The stack requires only that it exists.                     |
| `unsafe`               | `UnsafeSurface`     | [The bypass](#the-unsafe-surface).                                                        |
| `storage`              | `StorageUtils`      | File and image operations. See [Storage](/docs/reference/storage).                        |
| `plugins`              | plugin services     | Whatever registered plugins contributed.                                                  |
| `serverAction(props)`  | `Promise<unknown>`  | Generic create/update/delete entry point for Next.js Server Actions.                      |
| `sudo()`               | `Context`           | [Bypass access control, keep hooks](#sudo).                                               |
| `withSession(session)` | `Context`           | [Substitute the session](#withsession).                                                   |
| `transaction(fn)`      | `Promise<T>`        | [One interactive transaction](#transactions).                                             |
| `_isSudo`              | `boolean`           | Whether this context is elevated.                                                         |

{% callout type="warning" %}
List keys on `context.db` are **PascalCase, exactly as written in your config**. `context.db.blogPost` is a compile error; the key is `context.db.BlogPost`. There is no case-conversion helper to call — the generated types name the keys directly.
{% /callout %}

A hook and a plugin `runtime()` factory are handed an `AccessContext`, which has **no `unsafe` member**. What they reach instead is `context.ormHandle`: the engine's own client, which `db` runs its queries through and which enforces nothing on its own. The Write Pipeline rebinds it wherever it rebinds `db`, so the two are always in the same transaction state, and every write opens a transaction — work a hook does through either handle is rolled back when the write fails.

---

## The read subset

A read is **composed** on `context.db.<List>`, which is an immutable query value, and nothing runs until a terminal is called.

```typescript
const posts = await context.db.Post.where({ published: { equals: true } })
  .orderBy({ createdAt: 'desc' })
  .select('title', 'excerpt')
  .limit(20)
  .all()
```

These are the methods on `context.db.<List>`, and there are no others:

| Composer                 | Effect                                                                | Composition                                |
| ------------------------ | --------------------------------------------------------------------- | ------------------------------------------ |
| `where(predicate)`       | Narrow the read                                                       | **Accumulates** — repeated calls are ANDed |
| `orderBy(order)`         | Sort by this list's own scalar columns                                | **Accumulates**                            |
| `include(name, refine?)` | Reach one hop into a relation                                         | Accumulates, one entry per relation — naming the **same** relation twice is **refused** |
| `select(...fields)`      | Return exactly these of this list's own fields                        | **Replaces**                               |
| `limit(count)`           | At most this many rows                                                | **Replaces**                               |
| `offset(count)`          | Skip this many rows                                                   | **Replaces**                               |
| `distinct(...fields)`    | Collapse rows agreeing on every named column                          | **Refused** — a second `distinct`/`distinctOn` throws |
| `distinctOn(...fields)`  | First row per distinct key, in `orderBy`'s order — so it requires one | **Refused** — a second `distinct`/`distinctOn` throws |
| `cursor(values)`         | Resume from a known position                                          | **Replaces**                               |
| `forUpdate()`            | [Take a row lock](#the-row-lock) — transaction-bound builder only     | —                                          |

`limit()` shapes `all()` alone: `first()` is bounded by its own terminal and `nearest()` takes its bound from `options.limit`. `offset()` is honoured by **both** `all()` and `first()`, so `.offset(10).first()` is the eleventh row.

The two refusals above are refusals, not replacements. Both distincts **accumulate** into the read's state; the second is rejected at the **terminal** — where every other refusal on this surface is made — with a `ValidationError` reading "Cannot read … through more than one distinct. Name every column in one call instead." `distinct` and `distinctOn` collapse rows by different rules and the variadic form already spells "on both columns" in one call, so there is no sensible last-wins. A repeated `include` is refused the same way.

A [singleton list](/docs/reference/config-api) has `get()` in place of the composed read.

{% callout type="warning" %}
There is no `findMany()`, no `findUnique()`, no `findFirst()` and no top-level `count()`. A count is `aggregate()`; a lookup by id is `.where({ id }).first()`.
{% /callout %}

### Terminals and denial values

| Terminal                           | Returns                           | On denial           |
| ---------------------------------- | --------------------------------- | ------------------- |
| `all()`                            | `Promise<TRow[]>`                 | `[]`                |
| `first()`                          | `Promise<TRow \| null>`           | `null`              |
| `aggregate(build)`                 | `Promise<Record<string, number>>` | `0` under every key |
| `nearest(field, vector, options?)` | `Promise<NearestMatch<TRow>[]>`   | `[]`                |

Denial is silent and indistinguishable from absence — see [Silent failure](#silent-failure).

### Refusals

Some composers do not apply to some terminals, and are refused rather than quietly answering a different question:

| Terminal      | Refuses                                              |
| ------------- | ---------------------------------------------------- |
| `aggregate()` | `limit`, `offset`, `distinct`, `cursor`, `forUpdate` |
| `nearest()`   | `offset`, `distinct`, `cursor`, `forUpdate`          |

An aggregate returns no primary keys to lock, and a ranking is not a gate — so neither carries `forUpdate()`.

### `select()`

`select()` names **this list's own fields**, computed fields included. Naming a relation throws `RelationSelectError`; relations are reached with `include()`.

```typescript
const rows = await context.db.Post.select('title', 'excerpt').all()
```

The result type narrows with the projection, and the list's system fields always survive it. An unselected column is a compile error rather than an absent value.

The engine **widens** the query for what it needs — the declared dependency sets of the computed fields it will return, and any field `read` rule that has to see a row to answer — and then **strips** everything it added back out, at every nesting level.

### `include()`

`include(name, refine?)` takes a **refinement callback**, not a boolean.

```typescript
const rows = await context.db.Post.select('title')
  .include('author', (author) => author.select('name'))
  .all()
```

A refinement carries `where`, `orderBy`, `limit`, `offset`, `select`, `include`, `count()` and `combine(spec)`. `limit` and `offset` inside a refinement page the related rows **per parent row**. `count()` reduces a to-many relation to how many rows this session may see; `combine(spec)` gives several independently scoped views of the same relation, at most one of which may be the rows themselves.

The related list's `query` access rides in as a refinement `where`, so a scoped-away to-one comes back `null` and a to-many `[]`, with the key present and the parent row kept.

Includes are capped at **five levels** deep.

#### Cost: every to-one read off an included row is a null-check

**Arity decides nullability, not foreign-key nullability.** A to-one relation types as `Row | null` and a to-many as `Row[]`, whatever the column's `NOT NULL` says — because access control can scope a row away that the schema guarantees exists.

```typescript
import type { Context } from '@/.opensaas/types'

async function authorName(context: Context, postId: string) {
  const post = await context.db.Post.where({ id: postId })
    .include('author', (author) => author.select('name'))
    .first()

  if (!post) return null
  if (!post.author) return null

  return post.author.name
}
```

This is a real cost of putting access control under the read rather than beside it, taken knowingly ([ADR-0058](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0058-a-to-one-relation-reads-as-nullable-by-arity-not-by-column.md)). Budget for the branch at every to-one hop.

### `aggregate()`

`aggregate(build)` reduces the read to named aggregates over the rows this session may see. The callback is handed an accessor; `count()` is the reduction it offers.

```typescript
const { published } = await context.db.Post.where({ published: { equals: true } }).aggregate(
  (a) => ({ published: a.count() }),
)
```

A count is a session-relative value, not a property of the table: it is the same scoped read `all()` runs, counted in the database instead of materialised, so it always equals that `all()`'s length. A denied read answers `0` under every key.

#### Cost: `aggregate`'s count throws beyond ±(2^53 − 1)

The result is a JavaScript `number`. Rather than round silently past the safe-integer boundary, `count()` throws ([ADR-0041](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0041-the-secured-surface-is-an-opaque-wrapper-over-a-prisma-8-collection.md)). A table large enough to reach it needs a different reduction, not a wider float.

### `nearest()`

`nearest(field, vector, options?)` ranks rows by an [embedding field](/docs/reference/rag)'s own distance function. It returns `NearestMatch<TRow>[]` — a wrapper, so `item` still matches your selection exactly and the score sits beside it rather than arriving as a field the list does not have.

The ranking, the `limit` and the `minScore` bound are all inside one query, alongside the Access Filter, so the top-K is computed over the rows this session may see rather than filtered down afterwards. Searching requires read access to `field`: ordering by a vector measures its contents.

### Materialisation

#### Cost: a secured read holds its whole result

`all()` returns an array, not a stream. The engine materialises every row it is about to hand back so that Field Visibility, `resolveOutput` and computed fields can be applied to each one — none of which can be expressed as a cursor over the driver's own result.

So **a large read is bounded by the caller**, with `limit()` and `cursor()`, and nothing bounds it if the caller does not ([ADR-0046](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0046-a-secured-read-materialises-and-does-not-stream.md)). A genuinely unbounded scan — an export, a backfill — belongs on [the Unsafe surface](#the-unsafe-surface), whose `query()` streams.

---

## The Where vocabulary

The vocabulary is a **closed set**. It is the same grammar for a caller's `where()` and for an access rule's returned filter, so a rule can never express something a caller could not.

**Scalar operators:** `equals`, `not`, `in`, `notIn`, `lt`, `lte`, `gt`, `gte`, `contains`.

**Relation quantifiers:** `some`, `every`, `none` — the same three for a to-one relation as for a to-many.

**Logical keys:** `AND` and `NOT` each take one predicate object or an array of them. `OR` takes an **array only** on the generated types — the runtime accepts a bare object, but writing one is a compile error.

```typescript
const rows = await context.db.Post.where({
  OR: [{ published: { equals: true } }, { authorId: { equals: 'user-123' } }],
  title: { contains: 'release' },
  comments: { some: { flagged: { equals: false } } },
}).all()
```

The rules that decide what compiles and what throws:

- **A bare value is equality.** `{ published: true }` and `{ published: { equals: true } }` are the same predicate. A value is `string | number | boolean | bigint | Date | null`.
- **`null` is `IS NULL`.** Bare `null` and `equals: null` both compile to `IS NULL`; `not: null` compiles to `IS NOT NULL`.
- **`undefined` is refused, never dropped.** A `ValidationError`, not an open read. This is the fail-closed rule that makes `({ session }) => ({ authorId: { equals: session?.userId } })` an error rather than a filter that silently matches everything. Decide the anonymous case explicitly — return `false` from the rule.
- **`contains` is case-insensitive.** It lowers to `ilike` and matches its value literally, per-cent signs and underscores included.
- **`orderBy` takes this list's own scalar columns only.** A relationship throws.
- **An unknown key and a read-denied field give the identical message.** Deliberately: the refusal must not be an existence oracle ([ADR-0031](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0031-a-predicate-cannot-name-a-field-the-session-cannot-read.md)).

There is **no `startsWith`, no `endsWith`, no `mode`, and no `is`/`isNot`**. `contains` covers substring matching; the rest were dropped rather than carried across from Prisma's own filter grammar.

An access filter may nest ten levels deep.

`sudo()` still validates the vocabulary — only the access decision is skipped, never the grammar.

---

## The write subset

`create`, `update` and `delete` each take a single **args object**.

```typescript
const post = await context.db.Post.create({ data: { title: 'My Post' } })
const updated = await context.db.Post.update({ where: { id }, data: { title: 'Renamed' } })
const removed = await context.db.Post.delete({ where: { id } })
```

Each returns `Row | null`, and `null` is denial-or-absence. The composed read's `where()` never feeds a write: there is no `.where({ id }).update(data)` form.

### `where` is identity-only

A write's `where` must be **exactly one key, `id`, holding a `string` or a `number`**. Anything else is a `ValidationError` raised _before_ the access gate, and on the generated types a secondary unique column — `where: { email }` — is a compile error.

That is not a limitation of the query planner: an update reached by a column other than the primary key cannot name the row it is about to gate, so the access decision would have to be taken against a set.

### Relation input

On the **foreign-key-owning side**, a relationship field takes `{ connect: { id } }` or `null`.

```typescript
await context.db.Post.update({
  where: { id: postId },
  data: { author: { connect: { id: authorId } } },
})

// `null` clears the edge
await context.db.Post.update({ where: { id: postId }, data: { author: null } })
```

`null` is how an edge is cleared — **there is no `disconnect`**.

Refused, at runtime and as compile errors on the generated input types:

| Input                                                                                                          | Error                           |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Nested `create` / `update` / `delete` / `connectOrCreate` / `disconnect` / `set` / `updateMany` / `deleteMany` | `NestedRelationInputError`      |
| Relation input on a field that does not own the foreign key                                                    | `NonOwningRelationInputError`   |
| Spelling one edge both ways (`author` _and_ `authorId`)                                                        | `ConflictingRelationInputError` |

A `connect` target the caller cannot read makes the whole write return `null` — one indistinguishable answer, the same one denial gives.

---

## Transactions

```typescript
import type { Context } from '@/.opensaas/types'

async function publish(context: Context, title: string) {
  return context.transaction(async (tx) => {
    const post = await tx.db.Post.create({ data: { title } })
    if (!post) return null
    await tx.db.AuditEntry.create({ data: { subject: post.id } })
    return post
  })
}
```

`transaction(fn)` takes the callback and **nothing else**. There is no options argument and no isolation level to select: it runs at the connection's default, Read Committed on PostgreSQL. A throw anywhere rolls the whole transaction back.

`tx` is a full context — access-checked and hook-firing exactly as the outer one is, but bound to the transaction client. It carries `tx.db`, `tx.unsafe`, `tx.sudo()`, `tx.withSession()`, `tx.session`, plus `tx.advisoryLock(key)`. A nested `transaction()` joins the enclosing one rather than opening a second.

{% callout type="warning" %}
The transaction holds **one pooled connection** for the whole callback. Work reached through `tx` runs on it; work reached through the **outer** context inside the callback asks the pool for a second connection — and on a single-connection pool, such as the Dev database's, waits for one that will not come.
{% /callout %}

### The row lock

Because there is no isolation level to raise, an invariant that a stricter level would have closed is expressed as a **lock on the contended row**. `forUpdate()` lives on the transaction-bound builder and nowhere else, so taking one outside a transaction is a compile error rather than a throw.

The shape is always the same: lock the parent **before** you read anything the gate depends on, so neither side of the comparison can go stale under a concurrent racer.

Both reads of `Slot` below are deliberate. The first takes the lock and answers only "may I proceed on this row"; the second fetches `capacity` in a statement that runs after the lock is held, because a locked read's own columns come from the snapshot taken before the lock. The count follows for the same reason.

```typescript
import type { Context } from '@/.opensaas/types'

async function book(context: Context, slotId: string) {
  return context.transaction(async (tx) => {
    const locked = await tx.db.Slot.where({ id: slotId }).forUpdate().first()
    if (!locked) return null

    const slot = await tx.db.Slot.where({ id: slotId }).first()
    if (!slot) return null

    const { taken } = await tx.db.Booking.where({ slotId: { equals: slotId } }).aggregate((a) => ({
      taken: a.count(),
    }))
    if (taken >= slot.capacity) return null

    return tx.db.Booking.create({ data: { slot: { connect: { id: slotId } } } })
  })
}
```

`first()` returning `null` under `forUpdate()` means denied-or-vanished, extending the conflation silent failure already makes deliberately.

`advisoryLock(key)` takes PostgreSQL's transaction-scoped advisory lock, waiting until it is free and releasing when the transaction ends however it ends. It locks a number rather than rows, which is why it sits on the transaction context and not on `db`.

#### Cost: a row lock is two round trips

`forUpdate()` is **two statements**, not one. The scoped read resolves operation access, the Access Filter and Field Visibility exactly as any read does; the engine then locks the identity rows it returned. That is what makes the locked set provably a subset of the readable set — and it costs a second round trip.

Two consequences follow, and both are taken knowingly ([ADR-0047](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0047-a-row-lock-is-an-engine-owned-two-statement-terminal.md), [ADR-0062](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0062-the-row-lock-statement-is-composed-by-the-engine-over-the-orms-raw-lane.md)):

- **The row's columns are as of before the lock.** Each statement takes its own snapshot under Read Committed, so a column another transaction committed in between arrives stale. Only the identity is post-lock — the lock is a mutex token on the row, not protection for the row's own data. Read a gate's threshold in its own statement _after_ the lock, which is why the sample above re-reads `Slot` for `capacity` rather than taking it off the locked row.
- **`all().forUpdate()` is bounded** at 1000 keys in one terminal — a fail-closed cost limit, raised rather than silently truncated.

`advisoryLock` hashes its key with `hashtext()`, which is 32-bit, so two distinct keys can collide. A collision costs **spurious serialisation, never a missed lock**.

---

## Silent failure

Access denial returns the empty value of the operation's type rather than throwing. There is no `AccessDeniedError`.

| Operation                            | Denied returns      |
| ------------------------------------ | ------------------- |
| `all()`                              | `[]`                |
| `first()`                            | `null`              |
| `aggregate()`                        | `0` under every key |
| `nearest()`                          | `[]`                |
| `create()` / `update()` / `delete()` | `null`              |

The point is that the answer is **identical** whether the row does not exist, the session may not see it, or an access filter scoped it away. An error that distinguished them would be an existence oracle.

So every one of those results is checked before it is used:

```typescript
import type { Context } from '@/.opensaas/types'

async function rename(context: Context, id: string, title: string) {
  const post = await context.db.Post.update({ where: { id }, data: { title } })
  if (!post) {
    return { error: 'Unable to update post' }
  }
  return { title: post.title }
}
```

If you genuinely need to distinguish "absent" from "denied" — for an admin diagnostic, say — re-run the read under [`sudo()`](#sudo) and compare. Do that deliberately, and never in a response a non-privileged caller sees.

---

## Errors

The stack owns its error classes, all exported from `@opensaas/stack-core`. A secured write normalises the driver's failure into one of them; there are no database error codes to switch on.

| Class                                                 | Carries                             |
| ----------------------------------------------------- | ----------------------------------- |
| `ValidationError`                                     | `errors`, `fieldErrors`             |
| `DatabaseError`                                       | `fieldErrors`                       |
| `SerializationFailure` (extends `DatabaseError`)      | SQLSTATE 40001, surfaced as a class |
| `UniqueConstraintViolation` (extends `DatabaseError`) | `constraintName`, `list`, `fields`  |

Two predicates narrow without an `instanceof` chain: `isSerializationFailure(error)` and `isUniqueConstraintViolation(error)`.

```typescript
import { isSerializationFailure, isUniqueConstraintViolation } from '@opensaas/stack-core'
import type { Context } from '@/.opensaas/types'

export async function register(context: Context, email: string) {
  try {
    const user = await context.db.User.create({ data: { email } })
    if (!user) return { error: 'Access denied' }
    return { id: user.id }
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      return { fieldErrors: error.fieldErrors }
    }
    if (isSerializationFailure(error)) {
      return { error: 'Please retry' }
    }
    throw error
  }
}
```

Retrying a `SerializationFailure` is **the caller's own loop** — the stack ships no retry helper, because the right number of attempts and the right backoff are properties of the operation, not of the engine.

A secured write resolves the constraint name to OpenSaaS field names through the generated constraint map. A hand-made constraint the generator did not emit is not in that map, so it keeps a generic message and an empty `fields` — see [`db.indexes`](/docs/reference/config-api).

The **Unsafe surface performs no normalisation at all**: a failure there arrives as the raw driver error.

---

## `sudo()`

`sudo()` returns a context with the **access decision** bypassed. Everything else still runs.

| Bypassed                                                       | Still runs                                          |
| -------------------------------------------------------------- | --------------------------------------------------- |
| Operation-level access (`query`, `create`, `update`, `delete`) | Every hook                                          |
| Field-level access (`read`, `create`, `update`)                | Field validation                                    |
|                                                                | Field transformations (password hashing, and so on) |
|                                                                | Where-vocabulary validation                         |

```typescript
import type { Context } from '@/.opensaas/types'

export async function purgeExpiredSessions(context: Context) {
  const elevated = context.sudo()
  const expired = await elevated.db.Session.where({ expiresAt: { lt: new Date() } }).all()

  for (const session of expired) {
    await elevated.db.Session.delete({ where: { id: session.id } })
  }
  return expired.length
}
```

Sudo is not an authorisation — it is you taking the decision instead of the engine. Check the caller's right to elevate _before_ you elevate, in code the caller cannot reach.

## `withSession()`

`withSession(session)` returns a context carrying a different session, reusing this one's config, client (including a transaction client — a call inside `context.transaction()` stays in that transaction) and storage. Access control and hooks run normally against the new session.

It substitutes **who** hooks and access control see; it does not change **what** they decide. The derived context can do exactly what a context built with that session directly could do. It is orthogonal to `sudo()` and preserves the receiver's sudo state, so `context.withSession(s).sudo()` and `context.sudo().withSession(s)` are equivalent.

```typescript
import type { Session } from '@opensaas/stack-core'
import type { Context } from '@/.opensaas/types'

async function completeAsOwner(context: Context, job: { ownerSession: Session; taskId: string }) {
  const asOwner = context.withSession(job.ownerSession)
  const task = await asOwner.db.Task.update({
    where: { id: job.taskId },
    data: { status: 'done' },
  })
  if (!task) {
    return { error: 'Task not updatable as its owner' }
  }
  return { id: task.id }
}
```

---

## The Unsafe surface

`context.unsafe` is the deliberately unsecured lane. Everything the secured surface does, it skips:

- no Access Filter
- no Field Visibility
- no `resolveOutput` and no computed fields
- no hooks
- **no error normalisation** — a failure arrives as the raw driver error, with a SQLSTATE rather than a `DatabaseError`

Scoping a query here is yours alone. Say why at the call site.

What it does give you: codec-decoded values, the ORM's streaming result, and the full builder.

| Member                 | What it is                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `unsafe.sql`           | The typed SQL builder, untouched                                                    |
| `unsafe.raw`           | The raw tag, untouched — `unsafe.raw.sql\`…\``                                      |
| `unsafe.orm`           | The ORM's collections behind a transparent, marking proxy: `unsafe.orm.public.Post` |
| `unsafe.query(plan)`   | Runs a plan for rows, lazily                                                        |
| `unsafe.execute(plan)` | Runs a plan for statistics                                                          |

`query()` returns a `LazyQueryResult<Row>` — an `AsyncIterable<Row>` that is also a `PromiseLike<Row[]>`, with `toArray()` and `first()`. That streaming is the reason the surface exists for bulk work: it is the one lane a genuinely unbounded read can take.

```typescript
import type { Context } from '@/.opensaas/types'

async function archiveEveryPost(context: Context) {
  const rows = context.unsafe.query<{ id: string }>(
    context.unsafe.sql.public.Post.select({ id: true }).build(),
  )
  for await (const row of rows) {
    await archive(row.id)
  }

  return context.unsafe.execute(
    context.unsafe.raw.sql`UPDATE "public"."Post" SET "archived" = true`.affectedCount().build(),
  )
}
```

Inside `context.transaction(...)`, the transaction context's `unsafe` runs through the transaction's own executor, so a script need not close over the outer client.

Neither the bare client nor `prepare()`/`runtime()` is reachable through it, in the type or in the runtime value: a prepared statement runs `beforeCompile` once at `prepare()` and never per execution, and an already-compiled plan handed to `runtime()` bypasses the middleware chain — either would execute unobserved.

### Known limits

- That is a statement about the surface's own members, not a claim that nothing reachable through the ORM lane can prepare. The lane is the ORM's collections, whole; a `prepare`-shaped member on one of them is proxied like any other call, which marks the preparation and not the executions that follow.
- The ORM's raw guardrails (`lints()`, `budgets()`) are opt-in middleware and the stack installs none. A statement this surface runs meets whatever your application armed, and nothing else.

### When to reach for it

| Reason                                         | Better answer                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| "I need a filter the vocabulary does not have" | Usually a modelling problem. Add the column.                                 |
| "I need a join"                                | `include()` with a refinement                                                |
| "I need a count"                               | `aggregate()`                                                                |
| "I need an unbounded export or backfill"       | **This is the case.** `unsafe.query()` streams; a secured read materialises. |
| "I need a DDL statement or an extension call"  | **This is the case.**                                                        |

---

## Next Steps

- **[Queries & projections](/docs/concepts/queries)** — the ideas behind the read surface
- **[Access Control](/docs/concepts/access-control)** — writing the rules the surface enforces
- **[Config API](/docs/reference/config-api)** — `db` keys, indexes, referential actions
- **[Hooks](/docs/concepts/hooks)** — what runs, and in what order
- **[Field Types API](/docs/reference/fields-api)** — the field builder contract
