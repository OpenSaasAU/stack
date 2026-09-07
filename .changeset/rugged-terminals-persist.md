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

Nested relation input is gone from the write payload (ADR-0050).
`create`/`update`/`delete`/`connectOrCreate`/`set`/`updateMany`/`deleteMany`
under a relationship key are a compile error against the generated input types
and a `NestedRelationInputError` at runtime. Write the related rows yourself and
wrap them in `context.transaction` when they must land together:

```typescript
await context.transaction(async (tx) => {
  const author = await tx.db.Author.create({ data: { name: 'Ada' } })
  await tx.db.Post.create({ data: { title: 'Notes', authorId: author.id } })
})
```

`connect` and `disconnect` are the two spellings ADR-0050 keeps, and the engine
has no lowering for them yet. Until it does they are refused by name with a
`RelationInputNotLoweredError` naming the list, the field and the issue that
brings them back (#1153), rather than reaching the driver as a column value and
failing as a raw type error that names none of those. The refusal is checked
against both the caller's payload and the data a `resolveInput` hook produced,
and it covers a synthetic `from_<List>_<field>` back-relation key as well.

`afterTransaction` no longer reports `committed` for a write that persisted
nothing. A write whose predicate matched no row — the row dropped by a
`beforeOperation` hook, say — answers `null` to the caller and `rolled-back` to
the bracket, so a compensator keyed on `committed` never acts on a write that
did not happen.

`context.db.<List>.createMany` and `updateMany` are removed — both ran one
secured write per item, which `context.transaction` expresses directly — and
`packages/core/src/context/nested-operations.ts` is deleted with them.
