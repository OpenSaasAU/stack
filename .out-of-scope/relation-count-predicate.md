# To-many count predicates

The Where vocabulary does not compare the number of related rows. `some`, `every` and `none` express presence and absence. There is no `posts: { count: { gt: 5 } }`, no `_count` key, and no fourth quantifier. The admin filter `posts:0` lowers to `none()`, `posts:>0` and `posts:>=1` lower to `some()`, and any other count degrades to free text.

## Why this is out of scope

Every Where vocabulary predicate is lowered onto Prisma's own relation filter, which carries the related list's `query` access inside the `EXISTS`. Prisma 8's relation filter accessor has exactly three members:

```ts
type RelationFilterAccessor = {
  some(predicate?): AnyExpression
  every(predicate): AnyExpression
  none(predicate?): AnyExpression
}
```

`count()` exists only as an include reducer and an aggregate reducer, which are projections rather than predicates. `having` exists only on `groupBy`, which the secured surface does not offer.

So the only way to build a count predicate is for the engine to hand-assemble a correlated aggregate subquery out of the exported SQL AST nodes, and then carry the related list's access filter into it. That would be stack-authored SQL inside the security boundary, which is the read machinery the Prisma 8 rebuild deleted. ADR-0055 weighed this exact option and rejected it. The earlier `id IN (…)` resolver was rejected too, because ADR-0041 deliberately deleted unbounded id lists.

A caller who genuinely needs the comparison has two routes:

- Keep a denormalised counter column maintained by hooks, and filter on that scalar.
- Use `context.unsafe` and own the SQL, including the access reasoning it bypasses.

Revisit this only if Prisma grows a native count predicate on its relation filter. Then the predicate lowers like `some`/`every`/`none` and inherits their access scoping.

## Prior requests

- #1230 — "Reintroduce a to-many count predicate through the Where vocabulary"
