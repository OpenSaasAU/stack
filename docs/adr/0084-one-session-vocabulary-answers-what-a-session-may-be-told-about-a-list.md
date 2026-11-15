# One Session vocabulary answers what a session may be told about a list

Status: accepted

[ADR-0053](0053-the-mcp-vocabulary-omits-what-a-row-independent-rule-denies.md) made the Row-independent rule classifier the single interpreter of a rule and called every user of it a consumer. It left each consumer to turn classifications into its own picture of a list: which fields a session can ever read, filter, sort or write, and which operations are open to it. MCP built that picture in four places and the admin in about nine, and the admin's copy drifted. The same withholding fix landed four times, one admin screen at a time (#2289, #2291, #2356, #2363), and the admin came to disagree with the engine about the same rule (#2382, #2383).

We decided there is one **Session vocabulary** per list and context, resolved by one core module, and every consumer reads it. For each field it answers read, create and update as allow, deny or row-dependent; for the list it answers whether each operation is potentially allowed, by the engine's own rule. What is filterable and sortable is derived inside it. The classifier is unchanged and remains the only thing that interprets a rule.

It is disclosure only, as ADR-0053 said of MCP's schema. Field Visibility and the Access Filter still decide every read and write, so a wrong vocabulary can mislead a caller and can never widen what it gets.

## What the module owns

- **The operation rule.** No rule, `null` and `undefined` deny; `true` or a filter means potentially allowed.
- **A throwing rule denies and is logged.** A rule that throws for a reason other than reaching into the row answers deny, and the error is logged on the server. A broken rule never widens what a client is told and never takes a list screen down.
- **Sudo allows everything**, except writes to a Hook-only field, which stay denied (ADR-0076).
- **One list per vocabulary.** A relationship field's entry names its target and says nothing about the target's access. A consumer that needs that asks for the target's vocabulary.
- **Lifetime.** An answer is resolved lazily and kept on the context that asked. A context is built per request and per session, and `sudo()`, `withSession()` and a transaction each build a new one, so an answer cannot outlive a change of session. This is not the per-MCP-session cache ADR-0053 rejected.

## What stays with each consumer

The answer is three-way because consumers legitimately differ on a row-dependent rule, and ADR-0044 says they are not to be harmonised:

- The admin withholds a denied field from the client and keeps a row-dependent one shown and editable.
- MCP omits a denied field from what it advertises and keeps a row-dependent one (ADR-0053).
- An include omits on deny and fetches on row-dependent (ADR-0044).
- A predicate refuses anything that is not allow (ADR-0031), which is why a row-dependent field is not filterable or sortable.

Row action and Bulk action gating is not part of the vocabulary. It is about an action on rows, not an operation on a list.

## Considered Options

**Booleans per consumer.** Rejected. A ready-made "never readable" or "potentially writable" set makes the module choose one consumer's policy for a row-dependent rule, which is the drift this record exists to end.

**Fields only, leaving operation access where it is.** Rejected. The operation rule had five spellings and one of them was wrong (#2382), and a field vocabulary for a list the session cannot query means nothing.

**Including each relation target's reachability.** Rejected. It duplicates the target list's own answer, and the second ask is free once answers are kept on the context.

**Treating a throwing rule as row-dependent.** Rejected. It keeps a field shown that a broken rule was guarding. Propagating the error was rejected too, because one broken rule would fail the list screen and `tools/list` for every session that trips it.

## Consequences

- Field configs cannot be serialised for a client without the vocabulary, so a new admin screen withholds by construction. The public serialiser changes shape to require it; the project has no consumers to break.
- The admin stops calling access rules and the field-access evaluator itself.
- A write rule that throws used to leave the field editable in the admin. It is now read-only there, as it already was absent from MCP's write schema.
- MCP's own derivations move onto the vocabulary in a later change. Until then there are two correct derivations and not one.
- What the admin sends as rows is unchanged by this record: withheld keys are still stripped from whole rows, not selected as a Projection.

## Amendment (2026-11-14): a consumer holding a row resolves it through core

A consumer that holds one known row may resolve the row-dependent write answers against that row instead of choosing a row-dependent policy. Core does it, through the engine context, against the stored row, as the write decides: it reads the row by id with the same identity read an update runs before deciding (every column, no relation, no Field Visibility), then evaluates the engine's own field `update` access and write-target resolution (the list's `update` and `delete`) against it; `allow` and `deny` are not asked again. A field's `read` is not resolved per row: the write never decides it, Field Visibility does on each read against the row that read delivers, so a row-dependent `read` stays `'row-dependent'` and the consumer takes the value from its own secured read. A caller names the row by id and never hands in its own copy, because a visible row (columns stripped, `resolveOutput` applied, relations included) can answer differently from the row the write decides on. The admin item edit form does this, so a field whose rule denies the row being edited stays read-only (#1402). Consumers without a row keep choosing their own row-dependent policy, as above. It is still disclosure only.

## Amendment (2026-11-15): answers are asked one question at a time

The vocabulary is also reachable as questions (`_sessionVocabularyQuestions`), each answer asked only when needed and kept once per context, sharing that memo with the whole vocabulary; a consumer wanting a few answers about a list asks the questions, and resolves the whole vocabulary only to serialise or advertise that list (#2419).

## Amendment (2026-11-15): how long an answer is kept

The memo is request-scoped, and four rules bound it (#2413):

- **Per context, cleared on write.** A context built by `getContext`, `sudo()`, `withSession()`, a transaction or a write's own hooks keeps each answer until a secured `create`, `update` or `delete` through it succeeds; a denied or failed write clears nothing. A write through a context derived with `sudo()` or `withSession()`, or through an `afterTransaction` context, also clears the context it came from. A rule that reads data the caller just changed must see the change on its next ask, and between writes the cost stays at one ask per rule.
- **A transaction clears its opener on commit.** The transaction context has its own memo, so nothing asked inside reaches the outer one. The outer memo can still hold an answer from before the transaction, so a transaction that commits with at least one successful secured write clears it. A rollback leaves it, since nothing it read changed.
- **Not on the process-wide context.** The generated `rawOpensaasContext` is held by `createAuth` for the life of the process, so no request bounds its memo. It is marked with `processLifetimeContext` and answers every ask afresh.
- **A derived `resolveOutput` context shares only what it is not part of.** It shares its read context's answers, so sibling hooks still ask each rule once. While one of that context's rules is being asked, a hook reached from that rule answers from its own memo, because the shared answer may be the one waiting on it. Following the resolve chain, the cycle guard then ends the recursion.
