# Queries & projections

Stack has **no GraphQL layer**. A read is composed on `context.db.<List>` — an
immutable query value — and narrowed with `.select()`, which the engine honours
exactly. There is no fragment to declare, no codegen step, and no result type to
infer by hand: the generated types give each list's surface its own shape.

```typescript
const summaries = await context.db.Post.where({ published: { equals: true } })
  .orderBy({ createdAt: 'desc' })
  .select('title', 'excerpt')
  .all()
```

Everything below runs through the same secured terminals — `.all()`,
`.first()`, `.aggregate()`, `.nearest()` — so your
[access control](/docs/concepts/access-control) rules are always enforced. The
[Context API reference](/docs/reference/context-api) describes each terminal and
what it returns; this page is about what a projection means.

{% callout type="info" %}
Migrating from Keystone? See the [Migrating from KeystoneJS](/docs/how-to/migrate-from-keystone) guide for a side-by-side translation table.
{% /callout %}

## `.select()`

`.select()` names the fields of **this list** you want back. It replaces any
previous call rather than accumulating, and the result matches it exactly.

```typescript
// Exactly these keys, plus the list's system fields
const rows = await context.db.Post.select('title', 'excerpt').all()
```

A computed field is selectable like any other. Selecting one returns it whether
or not you named the columns it is computed from. Below, `wordCount` declares
`needs: ['body']`: the engine reads `body`, computes the field, and leaves `body`
out of the result, because the call site never asked for it.

```typescript
const rows = await context.db.Post.select('wordCount').all()
```

That is the whole rule: the engine **widens** the query for what it needs — the
declared dependency sets of the computed fields it will return, and any field
`read` rule that has to see a row to answer — and then **strips** everything it
added back out, at every nesting level.

### Relations are reached with `.include()`, not `.select()`

`.select()` narrows this list's own columns; a relation arrives because a read
named it. The two compose, and naming a relation in `.select()` is refused:

```typescript
const rows = await context.db.Post.select('title')
  .include('author', (author) => author.select('name'))
  .all()
// → [{ id, createdAt, updatedAt, title, author: { id, createdAt, updatedAt, name } }]
```

A refinement takes its own `.select()`, so a projection is exact at every level.

### The result type narrows with the projection

The generated types read the projection off the call site, so an unselected
column is a compile error rather than an absent value — and so is a key the
list does not have.

```typescript
const [row] = await context.db.Post.select('title').all()
row.title // string
row.body // Property 'body' does not exist
```

## `.limit()`

`.limit(count)` bounds `.all()`. It replaces any previous call; `.first()` is
bounded by its own terminal, and `.nearest()` takes its bound from
`options.limit`.

```typescript
const recent = await context.db.Post.orderBy({ createdAt: 'desc' }).limit(20).all()
```

## What a `resolveOutput` hook sees

A computed field's hook is handed **exactly its own declared dependencies plus
the list's system fields** — never what the caller happened to select. So the
`item` below is `{ id, createdAt, updatedAt, body }` on every read of the list,
no matter what the call site selected.

```typescript
Post: list({
  fields: {
    body: text(),
    wordCount: virtual({
      type: 'number',
      needs: ['body'],
      hooks: {
        resolveOutput: ({ item }) => item.body.split(/\s+/).length,
      },
    }),
  },
})
```

This is what keeps a field's value the same from every call site. A hook that
reads something it did not declare finds nothing there — declaring it is what
earns the data. See [`needs`](/docs/reference/fields-api#needs) and
[ADR-0051](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0051-declared-dependencies-are-an-emitted-one-hop-set.md).

### The cost: a declaration outranks a caller's `read` denial

A declaration outranks a caller-facing `read` denial on the same column or
relation: the value reaches the hook, and is still stripped before the caller
sees it. That is what buys the property above — adding a `read` rule elsewhere
cannot silently change a computed field's value.

The price is the other direction of the same rule. `needs: ['passwordHash']` is
a deliberate, greppable way to surface a denied column's derived value: the
column's own `read` rule does not stop the hook from seeing it, and whatever the
hook returns is a field of its own, subject only to _that_ field's rules. The
stack does not try to guess which derivations are safe, so this is a cost you
own — grep your `needs` declarations when you audit a `read` denial. See
[ADR-0051](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0051-declared-dependencies-are-an-emitted-one-hop-set.md).

## A read with no projection

A read that names no `.select()` returns the row's own columns plus its computed
fields — **never its relations**, matching the ORM's own semantics for the same
call. Naming a relation fetches that relation's own columns and stops; reaching
further means naming further. See
[ADR-0024](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0024-a-read-with-no-include-fetches-scalars-not-relations.md).

## Denial is silent

A denied read returns the empty value of its type — `[]` from `.all()`, `null`
from `.first()` — rather than throwing, whether the rows do not exist or the
session may not see them. A projection changes nothing about that: the denial is
resolved before the query is built.
