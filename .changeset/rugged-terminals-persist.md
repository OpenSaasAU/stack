---
'@opensaas/stack-core': minor
---

The write terminals run over the rc.8 collection, and nested relation input leaves the payload

`create`, `update` and `delete` now reach the database through the Prisma 8
collection itself — `collection.create(row)`, `collection.where(…).update(row)`,
`collection.where(…).delete()` — instead of the Prisma 7 delegate names. Every
write still opens a transaction, and the phase order is unchanged: operation
access outside the transaction, then hooks, validation, writable-field
filtering, persistence, after-hooks and Field Visibility.

`update` and `delete` target a row by its identity and nothing else. The engine
lowers `id` alone into a write's predicate, so a `where` naming another column —
a secondary unique one included — is now a compile error against
`ListIdentityWhere`, and a thrown caller-shape error at runtime for a payload
that arrived untyped. It never silently writes nothing:

```typescript
// Compile error, and a throw at runtime: `email` selects no row to write.
await context.db.User.update({ where: { email: 'a@b.com' }, data: { name: 'Ada' } })

// Find the row, then write it by its id.
const user = await context.db.User.findUnique({ where: { email: 'a@b.com' } })
if (user) await context.db.User.update({ where: { id: user.id }, data: { name: 'Ada' } })
```

`update` and `delete` now merge the list's Access Filter into the predicate of
the write itself, beside the row's identity, so the statement acts on the same
rows the read would return:

```typescript
Post: list({
  access: {
    operation: {
      update: ({ session }) => ({ authorId: { equals: session?.userId } }),
    },
  },
})

// Runs `UPDATE … WHERE id = … AND "authorId" = …`; a row the filter excludes
// answers `null`, denied-or-gone, exactly as a denied read does.
await context.db.Post.update({ where: { id }, data: { title: 'edited' } })
```

Because the filter is lowered through the same Where vocabulary a read uses, an
Access Filter must now name fields the list declares — a rule that scoped by an
undeclared column is refused rather than silently passed through.

Nested relation input leaves the write payload, `connect` excepted (ADR-0050).
`create`/`update`/`delete`/`connectOrCreate`/`disconnect`/`set`/`updateMany`/`deleteMany`
under a relationship key are a compile error against the generated input types
and a `NestedRelationInputError` at runtime; `{ connect: { id } }` survives,
because it lowers onto a foreign-key column the row being written owns.

`disconnect` has a direct replacement on the side that owns that column — assign
`null` to the relationship field, which is the same column and the same
lowering. On a field owning no column, `null` is refused in turn with
`NonOwningRelationInputError`, so that edge is cleared by an update against the
target list. The remaining kinds have no replacement in the payload at all:
write the related rows yourself and wrap them in `context.transaction` when they
must land together:

```typescript
await context.transaction(async (tx) => {
  const author = await tx.db.Author.create({ data: { name: 'Ada' } })
  await tx.db.Post.create({ data: { title: 'Notes', authorId: author.id } })
})
```

`connect` is the one spelling ADR-0050 keeps, and the engine lowers it onto the
column the row carries — see `amber-keys-reach.md` for the reachability query it
issues first. An owning field carrying neither `{ connect: { id } }` nor `null`
is refused by name with a `MalformedRelationInputError` naming the list and the
field, rather than reaching the driver as a column value and failing as a raw
type error that names neither. Every refusal on this surface is checked against
both the caller's payload and the data a `resolveInput` hook produced, and each
recognises a synthetic `from_<List>_<field>` back-relation key rather than
mistaking it for a column of this list.

`afterTransaction` no longer reports `committed` for a write that persisted
nothing. A write whose predicate matched no row — the row dropped by a
`beforeOperation` hook, say — answers `null` to the caller and `rolled-back` to
the bracket, so a compensator keyed on `committed` never acts on a write that
did not happen.

`context.db.<List>.createMany` and `updateMany` are removed — both ran one
secured write per item, which `context.transaction` expresses directly — and
`packages/core/src/context/nested-operations.ts` is deleted with them.
