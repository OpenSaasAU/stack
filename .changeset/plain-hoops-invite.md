---
'@opensaas/stack-core': minor
---

Add `.include()` refinements to the secured read surface

`context.db.<List>.include(name, refine?)` reaches one hop into a relation and returns a new query value. The refinement is a related read with `where`, `orderBy`, `limit`, `offset` and a nested `include` — and no terminal, because the parent's terminal is the only thing that runs.

```typescript
const users = await context.db.User.include('posts', (posts) =>
  posts
    .where({ published: { equals: true } })
    .orderBy({ createdAt: 'desc' })
    .limit(5),
).all()
```

The related list's `query` access rides in as a refinement `where`, so a to-one the session cannot read comes back `null` and a to-many `[]` — with the key present and the parent row kept, whatever the session. Every key inside a refinement, and every synthetic back-relation (`from_<SourceList>_<field>`), is validated and scoped exactly as a top-level one; a relation whose own `read` rule is row-independent and denies is left out of the include before the query unless a live declared dependency set names it, and Field Visibility re-checks every relation it is handed regardless. An include tree deeper than `READ_INCLUDE_MAX_DEPTH` is refused with `AccessScopeDepthExceededError`.

A to-one's foreign-key column follows the relation's own visibility: it carries the related row's id when the relation is visible and `null` when it is not — scoped away by the Access Filter or stripped by Field Visibility alike — whatever `db: { foreignKey: { map } }` names the column. A relationship field the session cannot read is equally unqueryable under its foreign key, so `where({ authorId })` is refused exactly as an undeclared key is.

Two shapes are refused rather than served. Naming the same relation twice in one read throws `DuplicateIncludeError` — neither merging the two refinements nor letting one win is a safe silent answer. And a nested include of a to-one whose foreign-key column carries the relation's own name throws `NestedToOneIncludeError`: the include alias and the column collide in the emitted SQL, until [#1236](https://github.com/OpenSaasAU/stack/issues/1236) renames the column. `db: { foreignKey: { map: '…' } }` on that relation is the workaround, and reading it from a separate top-level include always works.

A read's include narrowing is derived from the contract's relation graph: a to-one reads as `Row<Target> | null` whatever its foreign key's nullability, a to-many as `Row<Target>[]`.
