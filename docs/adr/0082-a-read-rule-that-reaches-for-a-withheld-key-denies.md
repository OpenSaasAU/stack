# A read rule that reaches for a withheld key denies

Status: accepted

Extends [ADR-0001](0001-access-control-is-a-two-phase-read.md) on the post-query side and sits beside [ADR-0031](0031-a-predicate-cannot-name-a-field-the-session-cannot-read.md), which answers the same question before the query.

## Context

A field's `read` rule runs on an `item` the caller's read shaped. A rule asking about a relation could therefore be answered by what the read happened not to fetch (#2210):

- `include('notes', (r) => r.count())` stood `[]` in for the relation, so `item.notes.every(...)` passed for every rule reading it. A caller could open a sibling relation, a foreign key or a scalar by asking for a count, and a `where contains` count became a content oracle.
- `!item.notes?.some(...)` passed wherever the relation was not delivered, so absence read as permission on a bare read, under `.limit()`, on `combine` and over MCP.
- A foreign key's rule took a second decision on a second view of the row, so the caller's shape picked its outcome.

The guards added for each path (#2149, #2208) closed the shapes they named. Each new shape was a new guard.

## Decision

A rule is handed a guarded `item`. A reach for a **withheld key**, or a write through the row, denies that rule, whatever it then returns or throws. One mechanism in `access/rule-item.ts`, one evaluator (`checkRowRead`), and every rule that sees a fetched row goes through it: Field Visibility at every depth, a synthetic back-relation's source rule, and the foreign-key pass, which now reads the same `RuleView` Field Visibility does.

**What is withheld.** A relation key of the row's list — a declared relationship field or a synthetic back-relation — whose value is `undefined` under the rule's view. That covers a relation the read never named, one the read left out because a row-independent rule denied it, one the caller shaped (`where`, `limit`, `offset`, `orderBy`, `select`, a nested `include`), and a rowless reduction. The last is `isRowlessReduction` joining `narrowsWhatARuleSees` in `ruleViewFor`: the `[]` stand-in stays on the row for Field Visibility to decide on, and leaves the rule's view.

**What is not.** `null` is a relation that was fetched and found empty, so it is an answer. `[]` from an unshaped include is too. A scalar column is never withheld: a level carrying a row-dependent rule is already read at full width (ADR-0041). A key the list does not declare is `undefined`, as it always was. Declared rows the engine holds (ADR-0051) stay what the rule sees, for the Field Visibility pass and the foreign-key pass alike.

**The guard goes as deep as the rule does.** A related row is guarded under its own list's relation keys, so `item.project.tickets` denies when `tickets` was not delivered. A count one level down needs nothing further: a relation carrying a nested include is shaped, so the rule never reached it. A key inside a JSON column is not a relation.

**Reading.** Every way of asking about a key has a trap. `get` covers a property read, `?.` and destructuring; `has` covers `in`; `getOwnPropertyDescriptor` covers `Object.hasOwn` and `hasOwnProperty`.

**Enumeration denies.** `ownKeys` on a row withholding anything trips, which takes in `Object.keys`, `entries`, `values`, `for...in`, spread, rest bindings, `Object.assign` and `JSON.stringify`. A spread copy would otherwise leave the membrane carrying the row's absence with it, and `rest.notes` would read `undefined` unobserved. A row carrying every relation enumerates normally.

**Writing denies, and does nothing.** `set`, `defineProperty`, `deleteProperty`, `setPrototypeOf` and `preventExtensions` trip and refuse, at every depth including arrays and JSON values, so a rule cannot change what the next rule, a hook or the caller sees. A `Date` is copied, because its methods need the real object.

**The record is the decision, not a throw.** The trap records and returns `undefined`, and `checkRowRead` reads the record once the rule settles. A sentinel exception, as ADR-0031 uses, can be swallowed by a `try` inside the rule. So `item.logs.length` raises a `TypeError` and comes back a denial, and a rule that catches that error and returns `true` denies as well. A rule that throws without having reached for anything still propagates, and a non-boolean answer stays `InvalidFieldAccessResultError` (ADR-0030).

**Each evaluation has its own record**, so one rule tripping says nothing about the next rule on the row, and concurrent rows cannot race.

**Predicate time is unchanged.** `classifyRowIndependentRead` still uses the poisoned `item`, so what a `where` or `orderBy` may name is unchanged (ADR-0031).

## Considered options

- **Feed the rule unshaped rows.** Rejected. #2208 removed exactly that fetch: 1.1 GB of heap for 7.9 KB on the wire, for a rule that never looked at it, reachable by any session with `query` access. A bound changes the answer rather than the cost, since a rule over the first N rows is the shaped read again.
- **Another guard per path.** Rejected. Three rounds of that are why this record exists.
- **Withhold every key the row lacks, columns included.** Rejected. It would deny on a typo'd key or a computed field name, neither of which a caller can move.
- **Let a rule enumerate and hide absence.** Rejected for the reason above: no trap sees the read of a key on a copy.

## Consequences

- **A rule reading a relation now grants only where that relation is delivered whole.** It denies on a bare read and on any shaped read, for every row, including rows it would have granted given the rows. An unshaped `include()`, or a computed field returned alongside it that declares the relation, gives it the rows. A rule that must answer on every read issues its own `context.db` read, and pays for it per row.
- **The admin item view pages every Relationship table,** so a rule reading its own relation leaves that section empty and the rest of the page renders, where an unguarded rule used to render "Item not found".
- **An MCP `{ count: true }` on an unguarded rule** denies the relation rather than failing the query.
- **A rule that sorts a relation in place denies.** `toSorted()` or a copy works.
- **A rule that spreads `item` denies on any row withholding a relation,** which on a bare read is any list with a relationship.
- **The rows a rule does see are still session-relative.** An Access Filter on the related list narrows them, so `!item.notes.some(...)` sees only what the session can query (ADR-0051).

## Known limits

- A class instance other than `Date` — a `Decimal`, a `Buffer` — is handed over as it stands, so a mutable one can be written through.
- `structuredClone(item)` throws, as it does for any `Proxy`, and that propagates. `util.inspect` and `console.log` read the target without touching a trap, which reveals nothing the rule could not read but records nothing either.
- A rule that keeps `item` and reads it after settling is not observed.
- Only `read` rules. An `update` or `delete` rule's `item`, and a field `create`/`update` rule's, are the row as the write fetched it, and absence can still read as permission there.

## Costs

A rule pays for one `Proxy` and one handler object per evaluation, built only when a rule actually runs, so a read with no `read` rules and a sudo read pay only a row-shaped lookup. Measured with `node` on an in-process PGlite, the median of 15 runs after 3 warm-ups, on a 2,000-row list with 8 field `read` rules of which 7 read a scalar. "After" is the range over three processes, and "before" one process, so the sudo row shows how much of the difference is noise:

| Read                                       | Before | After     |
| ------------------------------------------ | ------ | --------- |
| Bare, 2,000 rows                           | 24 ms  | 23–27 ms  |
| `include` of 5 children each plus a to-one | 88 ms  | 93–102 ms |
| The same read under sudo, so no rule runs  | 89 ms  | 82–92 ms  |

In isolation, a scalar rule goes from 0.002 µs to 0.03 µs per evaluation, and a rule walking 5 related rows from 0.03 µs to 0.9 µs. A rule walking 1,000 related rows goes from 5 µs to 141 µs, because each row it touches is guarded in turn, so the cost follows what the rule reads rather than what the read fetched.
