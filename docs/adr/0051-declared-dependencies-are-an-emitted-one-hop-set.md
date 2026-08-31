# Declared dependencies are an emitted, one-hop set that outranks a read denial

Status: accepted

ADR-0025 gave a computed field a way to name the relations its `resolveOutput` cannot compute without, and left the derivation of that dependency graph implicit. Three later records fixed the contract around it — [#1039](https://github.com/OpenSaasAU/stack/issues/1039) kept it config-derived, [ADR-0041](0041-the-secured-surface-is-an-opaque-wrapper-over-a-prisma-8-collection.md) made a terminal widen for it and strip its additions, [ADR-0044](0044-a-read-denied-relation-is-omitted-before-the-query.md) put a pre-query omission next to it — and none touched the derivation itself. This record does.

The derivation becomes a **generation-time artifact**: `pnpm generate` resolves each `(list, field)` into the set of sibling columns and relations that field needs, and emits it. `needs` widens to name **stored columns as well as relations**. The set is **one hop and non-transitive**. A declaration **outranks a caller-facing field `read` denial**. And a hook sees **its declared dependencies and nothing else**.

## The derivation is emitted, not walked

Two walkers over one graph is the drift shape ADR-0030 and ADR-0031 each spent a record eliminating: `foldDeclaredDependencies` traversed `config.lists` on every read, and `validateNeedsClosureDepth` re-walked the same graph at generation to prove the traversal would terminate. They agreed by discipline.

The generator already has to walk the graph to validate it, so emitting the result it computed is free. It emits a `(list, field) → dependency set` table into `.opensaas/`, reached by the engine through the generated context — the interface ADR-0032 already established, which keeps core free of a dependency on the generated tree's layout and lets a third-party field package's declarations flow through the same door as everyone else's. The table is **not** attached to the contract module: ADR-0040 makes that artifact standalone, fully literal and Prisma's, and this is neither Prisma's data nor expressible under the builder's purity rules.

At read time the engine unions the sets of the fields it is about to compute — which, per ADR-0027, is the fields that will be returned. The runtime traversal is deleted.

**Config derives; generation asserts.** [#1039](https://github.com/OpenSaasAU/stack/issues/1039) settled that the derivation reads the config rather than the emitted contract, because computing the set before emission and then reading it back would invert the dependency. [#1032](https://github.com/OpenSaasAU/stack/issues/1032) nonetheless puts the same graph contract-side as `domain…relations[]`, with `cardinality` and `on.localFields`/`targetFields`. Leaving two representations unchecked means a disagreement surfaces as a Prisma runtime rejection of an include we built; generation therefore **asserts** the emitted contract's relations agree with the config the set was derived from, and fails on divergence. One pass over an artifact just written, and the drift is a build error instead of a production one.

## `needs` names columns too, because projection is now universal

`needs` could only name relations, and validation rejected anything else. That was safe only because a bare read carried every stored column, so a hook reading a sibling column always found it. ADR-0041 makes `.select()` exact and available on **every** read — a caller selecting only the computed field no longer fetches the columns its hook reads. ADR-0041's widen-and-strip names the `needs` set and field-access resolution as its reasons to widen; columns-for-hooks was not among them. The hole is 0041's, not 0025's.

Three shapes were available. Always widening to the list's full stored width whenever any field on it computes preserves ADR-0027's wording verbatim, but throws away most of what exact selection buys and is a _second_ dependency rule sitting beside `needs`. Letting a hook see only what the caller selected is ADR-0025's silent degradation re-entering through the column door, and makes a field's value depend on the call site — the shape-varies-by-path fault ADR-0024 and ADR-0027 were both written against.

So `needs` covers columns. One rule — _declaring it is what earns the data_ — finally applied to columns as well as relations. The grammar stays a **flat array**: `needs: ['lineItems', 'price']`. The engine knows which kind each entry is from the field config, existing declarations stay valid, and the `Lists.<List>.TypeInfo` constraint is a wider union of keys rather than a new grammar — the same reasoning by which ADR-0025 rejected dotted paths. A list's system fields never need declaring, and declaring a relation implicitly carries its foreign-key column.

## One hop, and the closure stops being one

A declared branch delivers its rows' **stored columns**. No computed field runs on it. ADR-0027's rule is that a field computes if and only if it will be returned, and a branch fetched purely to satisfy a declaration is never returned to the caller at all — so making it literal is preferable to carving an exception into it.

That has a consequence larger than the choice. If no computed field runs on a declared branch, nothing on that branch declares anything, and the fold is **depth-1 and non-transitive**: a per-field dependency _set_, not a closure. Widening never triggers further computation, at any level. ADR-0025's rejection of dotted paths rested on "a dependency of a dependency is pulled in by the next level's own declaration" — that mechanism no longer exists.

Reach is therefore capped at one hop, stated as a limit rather than left as an accident. ADR-0025 pre-authorised the object form (`needs: { lineItems: ['product'] }`) as a non-breaking widening "if a single hook ever genuinely needs two hops", and it stays available on exactly those terms. Adopting it now would buy a grammar, its validation, its error messages and its template-literal types for no known consumer; ADR-0046's shape applies, where absence of demand defers rather than closes. A hook that genuinely needs two hops takes a privileged read inside itself — ADR-0025's own named escape hatch.

## The guards that survive, and the one that does not

A cycle is now **unreachable by construction**. `Order.total needs lineItems` with `LineItem.subtotal needs order` cannot recurse, because fetching `lineItems` no longer runs `subtotal`. Neither arm of `validateNeedsClosureDepth` — `cycle` or `depth` — can fire, so it is **deleted** along with the runtime `visitedLists` guard that belonged to the traversal.

ADR-0025's amendment warned that a guard annotated against a hazard that no longer exists reads as dead code, and that deleting it takes live protection with it. That warning is honoured by deleting the guard _deliberately_, in the same record that removes the hazard, rather than leaving an assertion over an impossibility for a later refactor to find. **ADR-0023's resolve-chain cycle guard is a different guard and is untouched** — it bounds hook-_issued_ reads re-entering Field Visibility, which this decision does not reach.

`validateNeedsDeclarations` stays, widened to accept column keys, and gains one refusal: a `needs` on a field with **no `resolveOutput`** fails generation. Nothing can consume such a declaration, so it is dead config — usually a hook deleted without its `needs`, or a `needs` written on the wrong field — and failing names it rather than leaving an author believing data is fetched that never is.

`READ_INCLUDE_MAX_DEPTH` keeps the job ADR-0043 re-homed it to: a pre-query cost limit over the **caller's** tree. The widening is **exempt**, so a read can reach caller-depth + 1. Charging the caller for it would let a legal read fail because of field config the call site cannot see — the action-at-a-distance ADR-0025 exists to prevent — and the set was proven to fit at generation regardless.

## Widen and strip, without provenance

`DeclaredOnlyTree` tracked which relation keys at which nesting level existed only to satisfy a declaration, so Field Visibility could strip them after hooks had read them. ADR-0041 makes `.select()` exact and replacing rather than accumulating, so the caller's selection and the widened selection are both explicit, complete trees the engine constructed. The strip set is their recursive difference — `additions = widened ∖ caller` — computed where the widening happens, mirroring the `{ selectedForQuery, hiddenColumns }` shape Prisma already returns from `augmentSelectionForJoinColumns`. The provenance tree is deleted.

## A declaration outranks a read denial

ADR-0044 contradicts itself here, and the implementation agrees with neither half. Its rule omits a read-denied relation from the include **before the query runs**; its consequence says a relation fetched for a declaration "is fetched for a **field**, not for the caller, so a caller-facing `read` denial on the relationship field does not suppress it" — which cannot hold if it was never fetched. Meanwhile `field-visibility.ts` had `accessDeniedKeys` beat `declaredOnly` outright, hiding the relation from the declaring hook.

**The declaration wins, and ADR-0044's pre-query omission exempts relations in a live dependency set.** A field-level `read` rule governs what the _caller_ may receive, which the strip already guarantees they do not; ADR-0025's session-relative rule is about the Access Filter scoping _rows_, a different axis. Under the alternative, adding `read: () => false` to a relationship field silently changes an unrelated computed field's value on the same list — action at a distance of exactly the kind ADR-0025 exists to prevent.

The rule is **symmetric across columns and relations**: declared means fetched for the field and stripped for the caller, whatever was named. An asymmetry would leave "declaring it earns the data" true for relations and false for columns, which is two rules wearing one name. The `accessDeniedKeys`-beats-declaration precedence flips accordingly.

Row scoping is untouched. The Access Filter still scopes what a declared relation returns, so values stay session-relative.

## A hook sees its declarations and nothing else

`computedFieldItem` was "keys that survived into the filtered result" ∪ "declared-only keys", minus access-denied — so a hook saw whatever else the caller happened to select. With projection universal, that makes a hook's view vary with the call site.

A hook's `item` is now **its declared dependencies plus the list's system fields, and nothing else**. Caller-independent by construction: the same field cannot compute differently because someone else's selection widened the row. ADR-0027 named the accidental-coupling class — a hook working only because another field's declaration paid for a fetch — and closed it for declarations; this closes the remaining half, where the caller's projection paid for it instead. ADR-0027's "no field's resolved output" rule is unchanged and is subsumed: a resolved value was never in the dependency set to begin with.

**"System fields" is per list, not a fixed triple.** `id` is universal; `createdAt` and `updatedAt` are not. `db.timestamps` defaults to `false` and is overridable per list (ADR-0004, confirmed on new grounds by ADR-0048), so a model has a timestamp column only where the list declared the field or opted in — the generator already resolves this per list to decide what to emit. Naming a fixed `id`/`createdAt`/`updatedAt` in the widened selection would ask Prisma for columns that do not exist, and exact selection has no tolerance for that. The emitted table therefore carries each list's actual system fields alongside its dependency sets, resolved from the same pass that decides the model's columns rather than assumed at read time.

## Considered Options

- **Keep the runtime fold** (with generation calling the same walker so there is one implementation): rejected. It removes the drift without removing the per-read traversal, and the generator has already computed the answer.
- **Contract-side `domain…relations[]` becomes authoritative** after emission: rejected — this is the inversion [#1039](https://github.com/OpenSaasAU/stack/issues/1039) ruled out.
- **Config only, contract never consulted**: rejected. Simplest and honours #1039 exactly, but leaves a disagreement between the two representations to surface as a query failure.
- **Always widen to the list's full stored width**: rejected, as above — a second dependency rule, and it discards most of exact selection's value.
- **A hook sees only the caller's selection**: rejected — ADR-0025's silent degradation through the column door.
- **Split object grammar** (`needs: { fields: [...], relations: [...] }`): rejected. A breaking rewrite of every declaration for a distinction the config already encodes.
- **Computed fields run on a declared branch** (today's behaviour): rejected. It keeps ADR-0025's recursion argument alive, but only by giving ADR-0027's returned-iff-computed rule an explicit exception, and it lets the set fan out arbitrarily.
- **A `needs` entry may name a computed field on the related list**: rejected — this is the sibling-computed-field grammar ADR-0027 refused, now reaching across lists.
- **Adopt the object form for two-hop reach now**: deferred, not rejected. ADR-0025 pre-authorised it and it remains available; nothing first-party needs it.
- **Keep `validateNeedsClosureDepth` as a should-never-fire assertion**: rejected. A guard over an impossibility is the "reads as dead code" hazard ADR-0025 and ADR-0026 both named.
- **Charge the widening against `READ_INCLUDE_MAX_DEPTH`**: rejected. Honest about real cost, but it makes a caller's read fail for reasons invisible at the call site.
- **Denial beats declaration for columns** (keeping today's precedence, with relations declaration-wins): rejected. Safest of the three, and it would keep ADR-0036's read-denied credential fields closed against a one-line declaration — but it breaks the symmetry that makes the rule statable at all. The leak is real and is recorded below rather than designed away.
- **Allow a declaration except where the read rule denies for every session** (classifying with ADR-0031's poisoned-`item` Proxy, so `DENY_READ` fields stay unnameable): rejected as a third rule for a case the explicit, greppable declaration already makes auditable.

## Consequences

- **A hook reading an undeclared column breaks silently**, exactly as ADR-0025's undeclared relation did. This is the largest cost of the record. Detection leads the changeset: find `resolveOutput` hooks whose `item` reads a key absent from that field's `needs`.
- **`needs: ['passwordHash']` is a real leak channel.** A declaration outranking a `read` denial means a field author can surface a read-denied column's value — or a derived fact about a denied relation, a count or a total — through a computed field. It is explicit, greppable and owned by whoever wrote the declaration, which is the trade taken; ADR-0036's read-denied credential fields are no longer closed against config that deliberately names them.
- **The field-builder contract widens for every third-party field package.** `needs` accepting column keys reaches rag, storage and tiptap alongside the contract-shaped change [#1039](https://github.com/OpenSaasAU/stack/issues/1039) already lands on them.
- **A declared-only branch stops computing anything.** A config relying on a computed field appearing on a relation it never selected loses it — silently, since the key was already stripped from the caller's result.
- **Two hops now cost a privileged read.** A hook needing them takes one and owns the access decision explicitly, per ADR-0025's escape hatch, until the object form is adopted.
- **`pnpm generate` gains a refusal and loses two.** A `needs` on a hookless field fails; unsatisfiable-closure and cyclic-closure errors cease to exist.
- **ADR-0025 is amended**: its closure is a one-hop set, its cycle-guard amendment is discharged by the guard's deletion, and its dotted-path rejection now rests on cost alone rather than on recursion supplying the reach.
- **ADR-0027 is amended**: "a hook sees the row's stored columns and its declared relations" becomes "its declared dependencies and the system fields". Its selective-computation rule is unchanged and now decides what the engine widens for.
- **ADR-0041 is amended**: what it widens for is a set from an emitted table rather than a walk, and its strip is a set difference rather than tracked provenance.
- **ADR-0044's contradiction is resolved** in favour of its consequence: the pre-query omission exempts relations in a live dependency set.
- **The vocabulary changes.** "Declaration closure" becomes **declared dependency set** in `CONTEXT.md`; the old term asserted a transitivity the mechanism no longer has.
