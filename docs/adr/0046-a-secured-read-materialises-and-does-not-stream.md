# A secured read materialises and does not stream

Status: accepted

[ADR-0041](0041-the-secured-surface-is-an-opaque-wrapper-over-a-prisma-8-collection.md) made every terminal on the secured surface return a `Promise` rather than Prisma 8's dual-mode `AsyncIterableResult`, and said so **deliberately rather than on the merits** — a streaming shape would have settled [#1046](https://github.com/OpenSaasAU/stack/issues/1046) from the wrong ticket. #1046 has since landed as [ADR-0044](0044-a-read-denied-relation-is-omitted-before-the-query.md), and Field Visibility survives as an unconditional post-query phase that already walks rows one at a time — so the deferral's reason is gone.

We are keeping the outcome and replacing the reason. **A secured read materialises. `.all()` returns `Promise<T[]>`, and no terminal on the secured surface is an async iterable.** The grounds are structural, not the absence of a natural empty value that ADR-0041 cited.

## ADR-0041's stated reason was wrong

ADR-0041 argued that materialising "is also the only option where silent failure is unambiguous — a denied stream has no natural `[]`". That does not hold. Silent failure is the property that a caller cannot distinguish "denied" from "does not exist" (`CONTEXT.md`, **Silent failure**), and **an immediately-exhausted iterator has it exactly**: a `for await` loop that runs zero times is indistinguishable from one over a genuinely empty scoped set, in the same way and for the same reason `[]` is. Denial surfacing at the first `next()` would have been a workable answer.

Recording that matters. A future reader who reaches for streaming will notice the gap in 0041's reasoning within a minute, and would then be entitled to conclude the whole decision was unfounded. It was not — the reasons below are stronger than the one given, and they are why 0041's outcome stands rather than merely surviving.

## Denial is atomic; a stream cannot keep it that way

The real cost is **partial delivery**, which ADR-0041 did not name.

A materialised read fails as a unit. If a `resolveOutput` hook throws, if ADR-0023's cycle guard fires, or if [ADR-0022](0022-access-control-fails-closed-when-it-cannot-scope.md) refuses an include it cannot scope at depth, the caller receives nothing — the refusal reaches it before a single row does. That is what "fails closed" means here: the denial and the result are the same event.

Over a stream they are not. The consumer has already taken 4,999 rows when row 5,000 raises, and there is no way to un-deliver them. Every one of those rows has passed through Field Visibility and is individually legitimate — this is not a leak — but the operation as a whole can now only fail **open-then-stop**. A caller that writes the rows to a file, posts them to an API, or accumulates them into a total has committed to a prefix of a read that was refused. ADR-0022 exists precisely so that a scope the engine cannot compute is never partially honoured; streaming reintroduces partial honouring at the delivery layer, below where 0022 can see it.

This is the same shape as the failure mode ADR-0044 rejected when it declined to make the pre-query phase authoritative — a mechanism that converts a refusal into something a caller has already acted on.

## The resolve chain deadlocks on the local loop

A `resolveOutput` hook may issue its own read: [ADR-0023](0023-the-resolve-chain-is-bounded-by-a-cycle-guard.md) bounds the resolve chain rather than forbidding re-entry, and hook-issued reads are a documented capability. Those hooks run **per row, inside Field Visibility**.

Over a stream the outer cursor stays open for the whole traversal, so every hook-issued read needs a second connection while the first is held. [#1040](https://github.com/OpenSaasAU/stack/issues/1040) fixed the local loop as `prisma dev`, which **takes one connection**. The result is not a slowdown, it is a hang — in the default development environment, on a hook pattern the stack advertises, with no error to read.

A terminal that deadlocks under a supported hook on the supported dev loop is not a terminal we can offer.

## Streaming would be half-incremental and the caller could not tell which half

[ADR-0043](0043-bare-read-and-one-hop-become-the-orms-not-ours.md)'s investigation ([#1044](https://github.com/OpenSaasAU/stack/issues/1044)) found the include path **materialises parent rows internally**. A streaming secured read would therefore be genuinely incremental only on a read that names no relation — and, per the section above, only on one whose fields carry no re-entrant hook.

That subset is real but invisible. Two call sites differing by one `.include()` would have different memory profiles under an identically-typed terminal, and nothing at the call site says which you got. ADR-0041's subset principle is that **a method appears on the secured surface only if the engine knows how to scope it**; the test here is whether the engine can _stream_ it, and the answer is "sometimes, determined by an argument". A terminal whose central promise silently depends on the shape of the query is the dishonest passthrough that principle exists to prevent.

## The Unsafe surface is the named answer

A caller that genuinely needs a cursor — a bulk re-embed, a one-off migration script — uses the **Unsafe surface** (`CONTEXT.md`), the deliberately unsecured client reached under a name that states the bypass. Prisma 8's own `AsyncIterableResult` is available there in full.

The cost is stated rather than discovered: no access filter, no Field Visibility, no `resolveOutput`, no computed fields. The caller owns scoping entirely, exactly as [ADR-0045](0045-vector-search-is-an-engine-owned-terminal-over-a-native-vector-column.md) requires of raw SQL. This is not a workaround for a missing feature — it is where an operation that cannot preserve the secured surface's guarantees belongs, and naming it converts an omission into a destination.

_[ADR-0056](0056-app-authored-sql-lives-on-the-unsafe-surface-which-stamps-at-execution.md) gives that destination its SQL shape: the surface carries Prisma's typed SQL builder and raw tag untouched, `query(plan)` returns Prisma's own `AsyncIterableResult`, and the intentionally-unscoped stamp is applied by the surface's executor at execution rather than at any call site._

## The demand is absent, which is the weakest of these reasons

ADR-0041 dropped streaming without a use case being cited, and the sweep this record rests on found none. The repository's only unbounded row read is `packages/rag/src/config/plugin.ts`'s `rag_search` handler — `await context.db[dbKey].findMany()` over an entire list, then cosine similarity in JavaScript — and ADR-0045 deletes it, pushing the search into the database as a scoped `nearest()` terminal. `ListView` paginates against a scoped count, nav counts never materialise rows, MCP tools are bounded by ADR-0037, and the one `AsyncIterable` elsewhere in the tree (`packages/storage-s3`) streams bytes rather than rows.

This is listed last on purpose. Absence of demand would justify deferring the question again, never closing it; the sections above are what close it.

## Considered options

- **Returning our own `AsyncIterableResult` applying Field Visibility per row.** Structurally possible after ADR-0044 — the phase already walks rows singly. Rejected on partial delivery and the one-connection deadlock, not on feasibility.
- **Denial at construction rather than at first `next()`.** Would make a denied stream throw or return an exhausted iterator eagerly. Rejected as moot: access resolves lazily in the terminal (ADR-0041) and both candidates preserve silent failure, so this was never the deciding question.
- **Streaming only on include-free reads**, materialising the rest. Honest about the half-incremental finding. Rejected: it makes the terminal's contract depend on an argument, and a caller cannot see from the call site which contract it got.
- **A separate `stream()` terminal**, distinct from `.all()`, restricted to include-free reads with no re-entrant hooks. Rejected for the same reason at a different address — the restriction is not expressible in the type, so it becomes a runtime refusal for a capability nobody has asked for.
- **Amending ADR-0041's consequence in place** rather than adding this record. Rejected: 0041 was honest that it was deferring, and rewriting its reason would erase that this was ever an open question. Its consequence is amended to point here.

## Consequences

- **ADR-0041's materialisation consequence is amended** to cite this record rather than the natural-`[]` argument. Its decision is unchanged.
- **Memory is bounded by result size on every secured read.** A read over a large list is the caller's problem to bound with `limit`/`offset` or a scoped predicate — the surface offers no way to avoid holding the result. This is the cost paid for the guarantees above, and it should be paid knowingly.
- **This is revisitable on one specific change**, not on demand appearing: if the resolve chain's re-entrant reads are given a connection budget they cannot exhaust, and the include path stops materialising parents, the deadlock and half-incrementality arguments both fall. Partial delivery would remain, and would then have to be answered on its own.
- **Reasoned against `8.0.0-rc.8`.** The one-connection limit of `prisma dev` and the include path's internal materialisation are both pre-GA findings on this map's re-verification gate.
