# A predicate cannot name a field the session cannot read

Status: accepted

Field-level `read` access has always been a post-query check: Field Visibility strips a denied key from a row the database has already returned. Nothing constrained which fields a caller's `where`/`orderBy` could _name_. Since the access filter is ANDed onto the caller's `where` rather than replacing it, a constant access filter does not stop the result from varying with the caller's own predicate — so a read-denied field's value could be recovered by probing: `count({ where: { billingAddress: { startsWith: '12 ' } } })` differs from the same query with `'99 '` one character at a time, and `orderBy` leaks relative ordering across the whole table without naming a single value. This was independently reachable through the admin UI's own list view (filtering and sorting), not only by an application that forwards a caller-supplied `where` (#915).

We decided a field the session cannot read cannot be _named_ in a predicate either, checked before the query runs (`findMany`/`count`, the read seam #912 established), using the same evaluator Field Visibility already uses — `checkFieldAccess` — so there is exactly one place a field's `read` rule is interpreted, not two that could drift apart.

## The row-dependent case

The evaluator's `read` slot is typed with `item` always present (ADR the #914 fix established), because Field Visibility always has a fetched row to hand it. Predicate-time evaluation has no such row — the query has not run yet. A rule that depends on one (`item.ownerId === session?.userId`, the shape `InvalidFieldAccessResultError`'s own message recommends) cannot be answered here at all.

## Considered options

- **Skip the check for a row-dependent rule (i.e., let it through).** Rejected outright: it reopens exactly this hole for the fields most likely to be worth gating — a field whose visibility depends on ownership is a more sensitive field than one gated by a static role check, not a less sensitive one. An unanswerable check must not silently mean "allowed".
- **Deny at predicate time — chosen.** A rule that cannot be evaluated before the query resolves to `false`: the field simply cannot be named in a `where`/`orderBy`, regardless of what the same rule would have decided post-query for a specific row. This is knowable statically from the rule's shape (whether it dereferences `item`) so it degrades gracefully — a rule written to check only `session` (the common case for a field meant to be filterable/sortable) evaluates normally and returns its real answer.
- **Throw a distinct error for the row-dependent case**, forcing the field author to explicitly declare it as non-predicable. Rejected for now as unnecessary ceremony: the loud `ValidationError` the caller already gets ("cannot query — field denied by read access") communicates the same fact, and a config that never puts a row-dependent field in a filterable position never observes the distinction. Revisit if that proves to be a poor developer experience in practice.

## How "row-dependent" is detected

Detection is intentionally black-box rather than static analysis of the rule's source: the rule is called with a **poisoned `item`** — a `Proxy` whose `get`/`has`/`ownKeys` traps throw the moment anything touches it, including through optional chaining (`item?.x` still performs the property read once `item` itself is non-nullish, which the Proxy always is). A rule that never reaches into `item` completes normally; one that does throws, which `isFieldReadableForPredicate` catches and turns into `false`. A plain `item: undefined` was considered and rejected — it only catches a _non-optional_ dereference (`item.x`, which the type system already discourages by typing `item` as always present for `read`), and would silently misevaluate the officially-recommended `item?.ownerId === session?.userId` idiom into `undefined === undefined` for an anonymous session, which is `true`.

`InvalidFieldAccessResultError` (#913 — a rule returning a non-boolean) is deliberately **not** folded into this `false`: it propagates unchanged, so a config bug that would otherwise silently read as "field denied by policy" stays visibly a config bug.

## Consequences

- **The admin UI's own filter/sort affordances had to close alongside the engine, not after it.** `collectFilterSpecs` (and the `buildListFilterWhere`/`collectFilterSuggestions` built on it) now takes the session/context and excludes a field the session cannot read from the collected specs — a denied field's Filter spec is simply absent, so a `field:value` token degrades to free text (the engine's existing "unknown field" path) rather than ever reaching `context.db`. The list view's sort validation excludes the same fields from what a `?sort=` URL param may activate. Both were reachable independent of any caller-supplied `where` — see the issue for the reproduction through ordinary list-view filtering and sorting.
- **This narrows two public function signatures.** `collectFilterSpecs`, `buildListFilterWhere`, and `collectFilterSuggestions` (`@opensaas/stack-core`) now take a required `{ session, context }` argument and return a `Promise`, matching the shape `resolveRelationshipCountFilters`/`resolveRelationshipLabelFilters` already established for the same reason (#732, #749).
- **Scoped to the current list only.** The predicate walk checks whether a relationship field on _this_ list may be named at all (its own `read` access), but does not recurse into a related list's fields nested inside a relation filter (`{ author: { is: { email: ... } } }`) — that is #916's separate change. A field on a related list is unaffected by this record.
- **`sudo` is unaffected**, matching every other access seam — `checkFieldAccess` (and so `isFieldReadableForPredicate`) short-circuits to allow before a sudo context ever calls a field rule.
- **Denial is an error, not a narrowed or empty result** — a caller can never mistake "you may not ask that" for "nothing matched", which is the property that closes the probing oracle: the `count()` for a matching and a non-matching prefix now throws identically instead of differing.
