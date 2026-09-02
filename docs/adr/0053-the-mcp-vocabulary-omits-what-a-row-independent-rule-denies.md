# The MCP vocabulary omits what a row-independent rule denies, and `fields` lowers onto the secured surface

Status: accepted

[ADR-0037](0037-mcp-tools-advertise-a-bounded-projection.md) publishes a per-session vocabulary ahead of the request and filters it at the grain of **tools** — a list whose operation-level `query` denies the session vanishes from `tools/list`, and so does every relation entry pointing at it. It stopped at fields, and said why: field-level `read` "cannot be evaluated without a row". That reason was true of the evaluator's signature and is no longer true of the rules. [ADR-0031](0031-a-predicate-cannot-name-a-field-the-session-cannot-read.md) built a classifier that tells a rule the session alone can decide from one that needs the row, and [ADR-0044](0044-a-read-denied-relation-is-omitted-before-the-query.md) used it before a query runs. We decided the published vocabulary uses it too: **a field whose rule is row-independent and denies the session leaves the advertised schema**, on the `query` tool's `fields` projection at both enumerated levels and on the `create` and `update` tools' `data`. A row-dependent rule stays advertised, because it may pass for some rows or some payloads. The tool-level boundary ADR-0037 drew is unchanged; this record moves the grain, not the principle.

The same record settles how MCP's `fields` argument reaches the database once the fragment API is gone (ADR-0041): the projection module becomes a **translator** from the wire shape onto the secured surface, and its own post-query trimming is deleted.

## Why the schema may drop fields

ADR-0037 already accepted a per-session schema, and already filters it at two grains — lists in `tools/list`, relation targets inside the projection schema. Whether the vocabulary depends on the session was settled there. What was left was whether a field is a thing the schema can decide, and ADR-0037's answer rested on the evaluator wanting an `item`. ADR-0031's poisoned-`item` Proxy answers that per rule rather than per signature: a rule that never touches the row completes and returns its real answer, and only a rule that reaches into the row is unanswerable. The split is real in this repository — constants and auth's `DENY_READ` on one side, `isAuthor` on the other — and it is the exact condition ADR-0044 already acts on for the include.

The ticket that raised this ([#1064](https://github.com/OpenSaasAU/stack/issues/1064)) worried that a partial projection has no backstop: Field Visibility catches a missed omission in the include, but an advertised schema "the assistant simply believes". Looked at directly, the asymmetry does not exist, because **the schema is never authoritative**. A field the schema over-advertises is requested and then stripped by Field Visibility, exactly as every field is today. A field it under-advertises cannot be asked for at all. Neither direction can leak; the first is a wasted request and the second is a capability gap that fails closed. The only thing the schema decides on its own is **disclosure** — whether a session that cannot read `internalNotes` is told the field exists. ADR-0037 closed the same disclosure for list names and called it small but real. A field name is not smaller.

That leaves the objection ADR-0044 sustained against projecting scalars: a second interpreter of one rule kind. It does not apply here, and the reason is worth stating so nobody re-litigates it. ADR-0044 rejected the projection because it would have been a second _authority_ — a place whose omissions decide what the caller receives. The advertised schema decides nothing about what a caller receives. It is a fourth consumer of the one classifier, with a fourth semantic, and Field Visibility remains the only party that decides visibility.

## Reads: which fields leave the vocabulary

At both levels the projection schema enumerates, a scalar, virtual or relationship field whose `read` rule is row-independent and evaluates `false` for the session is **omitted**. A row-dependent rule leaves the field advertised. The classifier is per list, field and session, not per depth, so the rule is the same at level two as at level one.

Relationship fields are fields here. ADR-0044 already leaves a row-independent-denied relation out of the include; advertising it as selectable would invite a request the engine has already decided to ignore. The related-list `query` check that ADR-0037 introduced (`relatedListIfVisible`) is unchanged and runs alongside — a relation is advertised only if its own `read` rule does not deny the session _and_ its target list is queryable.

## Writes: the same rule, with the payload poisoned

The `create` and `update` tools' `data` schemas were static — built from the config alone, with no session in hand. That was worse than the read side's omission, not better: a field the session cannot write is advertised, requested, and the write **throws** (#568 made a denied write field an error rather than a silent drop). It is ADR-0037's own "advertising a tool the session will be refused on every call" case, one grain down.

A `create` rule receives `inputData`; an `update` rule receives `item` and `inputData`. None of these exist at `tools/list` time, so the classifier extends the poisoned Proxy to them: a write rule that touches neither the row nor the payload is row-independent and is evaluated; one that touches either stays advertised and the Write Pipeline decides per call, as it does today. This is the read rule's shape applied to writes — _what the session alone can decide is decided ahead of the request; what needs the call waits for the call_.

One case compounds. A field that is `isRequired` and row-independent-denied for `create` makes every `create` from that session fail. By ADR-0037's logic the tool is not advertised: **the `create` tool is dropped for that session**, the same way a list whose `query` denies drops all four.

## A dropped field refuses like an unknown one

ADR-0037's schema is strict: a name outside the vocabulary is refused with an error naming what was asked and what is available. A model that names a dropped field anyway gets that refusal, and it is **identical** to the refusal for a field that does not exist. ADR-0031's closing property was that the throw for a denied field and the throw for a nonexistent one cannot be told apart; a distinct "denied" message here would be the first place on the read path where "may not see" and "does not exist" diverge, and it would disclose exactly what omitting the field from the schema withheld. The per-session schema has already told the session everything it may know.

## One classifier, four consumers, one name

The mechanism now has consumers with four deliberately different semantics: ADR-0031 **throws** on a predicate, ADR-0044 **omits from the include**, this record **omits from the vocabulary** on reads and writes. None of them interprets the rule differently — all call the one evaluator with a poisoned argument — and the differences are in what each does with an answer, which ADR-0044 already named as the thing not to harmonise. What the mechanism lacked was a name of its own: `CONTEXT.md` carried only "Predicate-time read check", which names ADR-0031's consumer. It gains **Row-independent rule** for the mechanism, and the consumer keeps its term.

## `fields` lowers onto the secured surface

`projection.ts` translated the `fields` wire shape into a Prisma 7 `include` bag plus a `FieldSelection`, then trimmed the terminal's result with `pickFields`. ADR-0041 deletes both `pickFields` and `FieldSelection`, and makes a terminal's result match the caller's `.select()` exactly, with the engine widening for ADR-0051's dependency set and stripping its own additions. So the trim has nothing left to do, and the module becomes a **translator**:

- The wire shape of `fields` is unchanged. ADR-0037's contract with assistants holds; only what it lowers to changes.
- Root scalars and virtuals become `.select(...)`, with `id` forced at every level as before. The secured surface's `select` vocabulary is the list's **config fields**, stored and computed; the engine, not MCP, lowers a computed field to its emitted dependency set and strips back to the field. Prisma's own `select` is scalar-column-only and replaces on each call (`orm-client.mjs:3684`), which is why that lowering must live in the wrapper and nowhere else.
- A relation becomes `.include(name, r => r.select(...).where(...).orderBy(...).limit(min(take, 50)).offset(...))`. `limit` and `offset` on a refinement are applied per parent row (`orm-client.mjs:1648`), which is the nested page ADR-0037 specified. The nested caps stay.
- A count-only request becomes `.include(name, r => r.where(...).count())`. Rows **and** count for one relation become `.include(name, r => r.combine({ items: r.where(W).orderBy(...).limit(...).offset(...), count: r.where(W).count() }))` — one correlated subquery, one key, the `{ items, count }` shape the tool already returns. The count branch must not be chained after `limit`, since a reducer sees the paged set (`orm-client.mjs:1732`). **Naming the same relation in `include` twice does not do this**: the runtime appends without a guard and the decoder writes the key twice, last include wins (`orm-client.mjs:3668`, `:1990`). `combine` is the only correct spelling.
- **The count is the relation's value.** The old code included the relation's rows even for a count-only request so the relationship field's `read` rule would see rows, then folded Prisma's sibling `_count` in afterwards. Under a native reducer there is no sibling key: a row-independent rule is decided before the query (a denied relation is neither advertised nor included, so the reducer never runs), and a row-dependent one is evaluated by Field Visibility against the row as fetched, with the count in place. The rows-for-the-rule fetch and the `_count` folding are deleted with `projectMcpResult`.
- `where` and `orderBy`, at the root and inside a relation entry, stay free-form and lower to `.where()`/`.orderBy()`. The key-existence and predicate-time read checks (#912, ADR-0031) run in the terminal as for any caller; this record's vocabulary rule does not reach them, because there is no enumerated vocabulary there to prune.

## Considered options

- **Keep ADR-0037's tool-level boundary** (fields advertised regardless). Rejected: it keeps publishing a vocabulary the engine will never honour, which is the incoherence ADR-0037 refused one grain up, and it discloses field names to sessions that may not read them.
- **Drop row-dependent fields too**, generalising ADR-0031's deny-on-unanswerable to the vocabulary. One rule and no per-row surprises, but an assistant could never ask for an `isAuthor`-gated field even on rows the session owns — the capability removal ADR-0044 already declined.
- **Filter reads only, leave the write schemas static.** Scopes the change to the ticket's title. Rejected: the vocabulary would be self-inconsistent, and the write side is where a wrong advertisement throws rather than strips.
- **Keep a required-and-denied field advertised and let the write fail loudly.** Rejected as advertising a tool refused on every call.
- **A distinct "denied" refusal.** More legible to the model, and rejected for the disclosure above.
- **MCP's own classifier.** Rejected by ADR-0044 already; a fourth consumer is not a second mechanism.
- **Cache the per-session classification** for the life of the MCP session. A knob nobody has asked for; ADR-0026's stance on knobs stands. Uncached, revisit on a real complaint.
- **A defensive post-pick over the terminal's result** in MCP, in case the engine's strip and the caller's selection disagree. Rejected: it is a second copy of the exactness rule ADR-0041 already owes, and a disagreement there is an engine bug to fix, not one to paper over per consumer.
- **Composing the query on the Unsafe surface** and applying access in MCP. Rejected outright by ADR-0038 and ADR-0041's principle.
- **Graduating the lowering as its own ticket** beside [#1066](https://github.com/OpenSaasAU/stack/issues/1066). Considered and folded in here instead: once the vocabulary rule was settled, the lowering had no decision left in it that this record's facts did not already fix.

## Consequences

- **`tools/list` now runs field rules, not only operation rules.** One row-independent evaluation per advertised field, at both levels, plus the write rules — with a poisoned Proxy, so a rule that reads the row throws inside the classifier and is caught. A field rule that hits the database now runs per listing, as ADR-0037 already accepted for operation rules.
- **The vocabulary now differs by session at field grain.** ADR-0037 already made `tools/list` per session; nothing new for a client that honoured that, and a client that cached it across sessions was already wrong.
- **A `create` tool can disappear for a session** that could never complete it. This is a visible behaviour change in the same family as ADR-0037's vanishing lists.
- **ADR-0037 is amended in scope.** Its paragraph reasoning from "field-level `read` cannot be evaluated without a row" to "fields cannot be filtered" is struck and pointed here; its tool-level filtering, depth, wire shape and strictness all stand.
- **ADR-0044 gains a consumer.** Its "one classifier, two consumers" section is amended to name this one.
- **ADR-0051's declaration exemption does not reach the vocabulary.** A relation in a live dependency set is fetched for a field and stripped from the caller; the caller can never receive it, so whether it is advertised is decided by the caller-facing rule alone, and a row-independent denial still drops it from the schema.
- **`id` in the `update`/`delete` tools' `where` is per-list**, read from the contract through the boundary coercion #1047 defined. The `{ type: 'string' }` hardcoded today goes with it.
- **`projection.ts`'s `pickFields`, `FieldSelection`, `ResolvedFieldsProjection.fieldSelection`, `projectMcpResult` and the `_count` folding are deletions.** The refusal class and the schema generator stay; the translator is new.
- **The Prisma facts here are read from the shipped `.d.mts` and `.mjs` at `8.0.0-rc.8`, not from a compiler run** — `select`'s scalar-only variadic signature and replace-on-call, `combine` holding rows beside a reducer, the duplicate-`include` overwrite, and per-parent `limit`/`offset`. They join the map's CLI re-verification gate.
