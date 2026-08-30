# A read-denied relation is omitted before the query, and Field Visibility stays the boundary

Status: accepted

Prisma 8 makes projection an ORM native (#1031) and ADR-0039 turned `context.db` into a query-value surface whose terminals the engine composes, so the obvious optimisation is to encode field-level `read` denial as a projection: never select what the session cannot read, and delete the post-query pass that removes it. We decided **not** to, for scalars — and to make one narrow pre-query change for relations.

**Field-level `read` denial does not become a projection.** A denied scalar is fetched and stripped, as today. **A relationship field whose own `read` rule denies is omitted from the `include` before the query runs** — but only when the rule can be evaluated without a row, and Field Visibility re-checks every relation it is handed regardless.

## ADR-0001 is amended in scope, not superseded

ADR-0001's title says the phases cannot be merged, and a reader arriving from #1031 will test that claim against the ORM. Re-read, its argument is not about the ORM at all: field-level access functions receive the fetched `item`, and virtual fields are computed in JavaScript. Both are facts about **our own rule signature**, unchanged by Prisma 8 — Prisma 7 could already `select`. Nothing in the new ORM reopens the reasoning.

What ADR-0001 does overstate is the unit. Field Visibility carries **four** jobs, and only one was ever a merge candidate:

1. strip fields the session cannot read — the projection candidate;
2. run `resolveOutput` hooks;
3. compute virtual fields;
4. force a to-one relation to `null` where the related list's `query` access resolved to a filter Prisma cannot apply on an include (#974).

Jobs 2–4 are JavaScript over materialised rows. No projection reaches them, under any ORM. **The second phase survives whatever this record decides**, so the question is not "do the phases merge" but "does job 1 move into query construction".

## Why job 1 stays where it is

Field `read` rules split in two, and the split is real in this repository rather than hypothetical: constants (`() => true`, auth's `DENY_READ` per ADR-0036) and row-dependent (`isAuthor` — `({ session, item }) => session.userId === item!.authorId` — in five example configs). ADR-0031 already built the classifier that tells them apart before a query runs: `isFieldReadableForPredicate` calls the rule with a **poisoned `item` Proxy** that throws the moment anything touches the row.

So a projection could carry the session-only subset. It should not, because the cost of carrying it is a second interpreter of one rule kind — exactly the drift ADR-0030 and ADR-0031 each spent a record eliminating ("there is exactly one place a field's `read` rule is interpreted, not two that could drift apart"). ADR-0031 accepted an unanswerable-means-deny rule because the alternative reopened a **probing oracle**; here the alternative costs a scalar column's **bytes**. The same trade does not carry at a hundredth of the stakes.

A projection would also have to widen for what it cannot see. A row-dependent rule dereferences arbitrary keys of `item`, and the poisoned Proxy detects only _that_ the rule touched the row, never _which_ keys — so any list carrying one such rule falls back to fetching the row anyway. The saving evaporates on precisely the lists most likely to gate a field.

## Why relations are different

Relations are the one case where the cost argument is not about bytes, and where the pre-query phase is **already** the deciding party.

`buildAccessScopedInclude` evaluates the **related list's operation-level `query` access** and, when it denies, leaves the relation out of the include entirely — it is never fetched. It has never consulted the **relationship field's own** field-level `read`, which is checked only in `field-visibility.ts`. The consequence is that a caller-named relationship field whose `read` rule denies is **joined in full and then discarded**: real database work, not a column's bytes, thrown away every time.

So phase 1 gains one responsibility: a relation whose field-level `read` rule is **session-only** (per ADR-0031's classifier) and evaluates `false` is omitted from the include. This is an extension of a decision phase 1 already owns, not a new mechanism — the same phase, the same include, one more reason to leave a relation out. A row-dependent rule is not evaluated here at all; the relation is fetched and Field Visibility decides, as now.

## Field Visibility remains the boundary

The pre-query omission is an **optimisation that can only narrow**, never a security decision. Field Visibility checks every relation it is handed **unconditionally**, whatever phase 1 did or failed to do.

This is the answer to the failure mode the question was really about. Had the projection become authoritative, a missing entry in query construction would be a **silent leak** — precisely what ADR-0022 exists to prevent, relocated from a depth cap into a builder. With phase 2 unconditional, a missed omission is a **performance regression**: the relation is fetched, and then removed exactly as before. The two passes cannot disagree about what is visible, because only one of them decides.

ADR-0022's mechanism is untouched. Field Visibility keeps its no-depth-cap walk over a finite materialised tree, which is what makes "scoped rows with unfiltered fields" impossible rather than merely aligned. This is phase 2's absent cap, not `READ_INCLUDE_MAX_DEPTH` — the pre-query cost limit over a caller-written tree, whose justification ADR-0043 re-homed. The two are different quantities and neither moves here.

## One classifier, two consumers

The row-dependence classifier is now read by two callers with **deliberately different semantics**, and the difference is not an inconsistency to be harmonised away later:

- **ADR-0031, predicate-time — throws.** Naming a read-denied field in a `where`/`orderBy` is a caller error, and denial must be an error rather than a narrowed result: that identical-throw is the property that closes the probing oracle. A silently-dropped predicate would leave the oracle open.
- **Here, selection-time — omits silently.** A denied relation is simply absent, per ADR-0041's empty-value rule and the silent-failure convention. Throwing would leak that the relation exists.

A future reader will see one classifier feeding a throw and an omission and reach for consistency. The semantics differ because the _questions_ differ — "may you ask this?" versus "may you see this?" — and collapsing either into the other reopens a decision already made.

## Considered options

- **Projection for the session-only subset, post-query strip for the rest** (scalars included). The byte saving where it is statically safe. Rejected: two interpreters of one rule kind, for a saving that vanishes on any list carrying a row-dependent rule.
- **Projection only, denying row-dependent field `read` outright** — generalising ADR-0031's predicate-time answer to every read. One mechanism and the maximal saving, but it deletes `isAuthor`-style field gating, which five example configs use. A capability removal wearing a migration's clothes.
- **Extending the scalar answer to relations** (nothing pre-query at all). The most quotable rule. Rejected: it knowingly leaves a join on the floor in the one case the byte argument does not cover, and it declines a change that phase 1's existing responsibility already accommodates.
- **Making phase 1 authoritative for relations it omitted**, so phase 2 skips re-checking them. One check per field, no redundant evaluation. Rejected — it converts a construction bug into a silent leak, which is the ADR-0022 failure mode with a new address.
- **Measuring first.** Rejected for scalars: a benchmark cannot settle whether a second interpreter is worth its drift risk, and ADR-0022's precedent is against deciding a security-shaped question on a performance argument. The relation case did not need one — a discarded join is self-evidently more than a discarded column.

## Consequences

- **The saving is bounded and honest.** Denied scalars still cross the wire. Only a statically-deniable relation is spared, and only its join.
- **A denied relation stops paying for itself twice.** The relation is not fetched, so nothing beneath it is either — no nested access evaluation, no `needs` resolution inside a subtree the caller will never see.
- **Phase 1 now needs the session to build an include**, for the relationship fields it checks. This mirrors the signature change ADR-0031 already forced on `collectFilterSpecs` and friends for the same reason.
- **ADR-0025's declaration closure is unaffected.** #1039 settled that it stays config-derived rather than becoming a read of `contract.d.ts`; nothing here moves it. A relation fetched only to satisfy a `needs` declaration is fetched for a **field**, not for the caller, so a caller-facing `read` denial on the relationship field does not suppress it — the declaring field still computes on what its session can see (ADR-0025's session-relative value), and the relation is stripped from the result as it always was.
- **ADR-0041's widen-and-strip is the same shape and stays as-is.** The engine widens for the `needs` closure and for field-access resolution and strips its additions; the pre-query omission narrows the include and never widens it, so the two compose without a new rule.
- **Streaming is reopened, not settled.** ADR-0041 materialised every terminal deliberately, to avoid settling the two-phase read from the wrong ticket. With phase 2 confirmed to survive, per-row field visibility over a stream is structurally fine — but what silent failure means for a denied stream is a separate design question, and stays one. ADR-0043 hands it a second input: the include path materialises parent rows internally, so a streaming secured read would be genuinely incremental only on include-free reads. The pre-query omission recorded here removes work from a denied relation's subtree, which does not change that.
- **Nothing here was verified against a running Prisma 8.** Like the rest of this migration's records it is reasoned against `8.0.0-rc.8`; unlike most of them it depends on no new ORM capability, which is the point.
