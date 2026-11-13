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
