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

Everything below runs through the same secured terminals, so your
[access control](/docs/concepts/access-control) rules are always enforced.

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
or not you named the columns it is computed from:

```typescript
// `wordCount` declares `needs: ['body']`. The engine reads `body`, computes
// the field, and `body` is not in the result — you did not ask for it.
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

## What a `resolveOutput` hook sees

A computed field's hook is handed **exactly its own declared dependencies plus
the list's system fields** — never what the caller happened to select.

```typescript
Post: list({
  fields: {
    body: text(),
    wordCount: virtual({
      type: 'number',
      needs: ['body'],
      hooks: {
        // `item` is { id, createdAt, updatedAt, body } — on every read,
        // whatever the call site selected.
        resolveOutput: ({ item }) => item.body.split(/\s+/).length,
      },
    }),
  },
})
```

This is what keeps a field's value the same from every call site. A hook that
reads something it did not declare finds nothing there — declaring it is what
earns the data. See [`needs`](/docs/reference/config-api) and
[ADR-0051](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0051-declared-dependencies-are-an-emitted-one-hop-set.md).

A declaration also outranks a caller-facing `read` denial on the same column or
relation: the value reaches the hook, and is still stripped before the caller
sees it. Adding a `read` rule elsewhere therefore cannot silently change a
computed field's value — but it also means `needs: ['passwordHash']` is a
deliberate, greppable way to surface a denied column's derived value. Own it.

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
