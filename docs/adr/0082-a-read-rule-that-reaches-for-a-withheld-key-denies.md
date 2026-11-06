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

**A to-one the session cannot see is withheld too.** On an owning to-one, `null` beside a non-null foreign key is a row the related list's `query` access left out, not an empty relation. Otherwise `!item.owner?.banned` denies on a bare read and grants under `include('owner')`, and the caller picks. The inverse side of a one-to-one has no column to tell the two apart, so there it is withheld whenever the related list's access can leave a row out, and a genuinely empty inverse side denies such a rule: the cost of failing closed. A hook still reads the `null` it is owed (ADR-0058), which is why `scopedAway` is its own member of the view rather than one more removed key.

**What is not.** `null` on a to-one that has no foreign key set is an empty relation, so it is an answer, and so is `null` on an inverse side the related list does not scope. `[]` from an unshaped include is an answer too. A key the list does not declare is `undefined`, as it always was. Declared rows the engine holds (ADR-0051) stay what the rule sees, for the Field Visibility pass and the foreign-key pass alike.

**A scalar column is not tracked, because the classifier keeps it on the row.** A level carrying a row-dependent rule is read at full width (ADR-0041), so a rule that reads a scalar finds it. That rests on telling such a rule from one that never touches `item`, so the poison records a touch as well as throwing: a rule that catches the throw and answers `true` is still row-dependent. Before this it was classified `allow`, the level was narrowed, the column went missing, and the rule read that absence as permission, on `select`, on a nested `select` and through a `where` naming the field.

**The guard goes as deep as the rule does.** A related row is guarded under its own list's relation keys, so `item.project.tickets` denies when `tickets` was not delivered. A count one level down needs nothing further: a relation carrying a nested include is shaped, so the rule never reached it. A key inside a JSON column is not a relation.

**Reading.** Every way of asking about a key has a trap. `get` covers a property read, `?.` and destructuring; `has` covers `in`; `getOwnPropertyDescriptor` covers `Object.hasOwn` and `hasOwnProperty`.

**Enumeration denies on the row the rule was handed.** `ownKeys` on that row, while it withholds anything, trips, which takes in `Object.keys`, `entries`, `values`, `for...in`, spread, rest bindings, `Object.assign` and `JSON.stringify`. A spread copy would otherwise leave the membrane carrying the row's absence with it, and `rest.notes` would read `undefined` unobserved. A row carrying every relation enumerates normally.

A related row is different. A relation delivered whole carries no relations of its own, because a nested include is shape, so `item.notes.map((note) => ({ ...note }))` would otherwise deny on every read. Its absences are the same whatever the caller asked, so a copy of it hides nothing a caller can move, and enumerating it does not trip. A direct reach for `note.ticket` still does.

**Writing denies, and does nothing.** `set`, `defineProperty`, `deleteProperty`, `setPrototypeOf` and `preventExtensions` trip and refuse, at every depth including arrays and JSON values, so a rule cannot change what the next rule, a hook or the caller sees. A `Date` is copied, because its methods need the real object.

**The record is the decision, not a throw.** The trap records and returns `undefined`, and `checkRowRead` reads the record once the rule settles. A sentinel exception alone, as ADR-0031 first used, can be swallowed by a `try` inside the rule. So `item.logs.length` raises a `TypeError` and comes back a denial, and a rule that catches that error and returns `true` denies as well.

**Only a `TypeError` becomes a denial.** That is what dereferencing the `undefined` it was handed raises, and a refused write raises the same. Anything else propagates even after a trip, so a database failure inside the rule, or a rule's own `throw`, is not turned into a silently missing field. A rule that throws for its own reason on a withheld relation therefore fails the read, as it always did. A `TypeError` from a real bug after a trip is hidden, but that rule was denying anyway. A rule that throws without having reached for anything propagates, and a non-boolean answer stays `InvalidFieldAccessResultError` (ADR-0030).

**Each evaluation has its own record**, so one rule tripping says nothing about the next rule on the row, and concurrent rows cannot race.

**Predicate time** still uses the poisoned `item`, with the record above. A rule that catches the poison can no longer be named in a `where` or `orderBy`, which is what ADR-0031 always said of a row-dependent rule. The write and create classifiers share the same code.

## Considered options

- **Feed the rule unshaped rows.** Rejected. #2208 removed exactly that fetch: 1.1 GB of heap for 7.9 KB on the wire, for a rule that never looked at it, reachable by any session with `query` access. A bound changes the answer rather than the cost, since a rule over the first N rows is the shaped read again.
- **Another guard per path.** Rejected. Three rounds of that are why this record exists.
- **Withhold every key the row lacks, columns included.** Rejected. It would deny on a typo'd key or a computed field name, neither of which a caller can move.
- **Let a rule enumerate and hide absence.** Rejected for the reason above: no trap sees the read of a key on a copy.

## Consequences

- **A rule reading a relation now grants only where that relation is delivered whole.** It denies on a bare read and on any shaped read, for every row, including rows it would have granted given the rows. An unshaped `include()`, or a computed field returned alongside it that declares the relation, gives it the rows.
- **No rule can depend on rows the session cannot see.** An `include`, a declared dependency, a rule's own `context.db` read and a relation predicate in an Access Filter all run as the session, and a rule's `context` has neither `sudo` nor `unsafe`. So absence proves nothing wherever the related list is scoped: a session that cannot see a private row counts none and passes, while the row's author is denied. Two shapes are sound, and the docs offer only these. Grant on a row the session can see, so hiding it can only deny. Or keep the fact in a column on the row, written with the related row in one transaction, which reads the same for every session. Both were verified on a fixture with an Access Filter on the related list, beside the shapes that fail open (`secured/rule-evidence.test.ts`).
- **The admin item view pages every Relationship table,** so a rule reading its own relation leaves that section unavailable and the rest of the page renders, where an unguarded rule used to render "Item not found". The section says it can't be shown rather than that there are no rows, and the list view renders no number rather than a false `0`, because an unknown count is not zero.
- **An MCP `{ count: true }` on an unguarded rule** denies the relation rather than failing the query.
- **A rule that sorts a relation in place denies.** `toSorted()` or a copy works.
- **A rule that spreads `item` denies on any row withholding a relation,** which on a bare read is any list with a relationship.

## Known limits

- A class instance other than `Date` — a `Decimal`, a `Buffer` — is handed over as it stands, so a mutable one can be written through.
- `structuredClone(item)` throws, as it does for any `Proxy`, and that propagates.
- `util.inspect` and `console.log` read the target without touching a trap, so nothing is recorded. A rule that decides on their output escapes the guard: `!util.inspect(item).includes('public: false')` grants on a bare read, because the target carries no rows to find.
- A rule that keeps `item` and reads it after settling is not observed.
- A to-many narrowed by the related list's Access Filter is delivered as what the session can see, and cannot be told from the whole relation. That is the to-many form of the scoped to-one above, and it stays session-relative (ADR-0051).
- Only `read` rules. An `update` or `delete` rule's `item`, and a field `create`/`update` rule's, are the row as the write fetched it, and absence still reads as permission there. Tracked in [#2233](https://github.com/OpenSaasAU/stack/issues/2233).

## Costs

A rule pays for one `Proxy` and one handler object per evaluation, built only when a rule actually runs. Measured with `node` on an in-process PGlite, base and this change alternated over three runs each, the median of 15 reads after 3 warm-ups, on a 2,000-row list with 8 field `read` rules of which 7 read a scalar:

| Read                                       | Base     | After    |
| ------------------------------------------ | -------- | -------- |
| Bare, 2,000 rows                           | 19–20 ms | 21 ms    |
| `include` of 5 children each plus a to-one | 77–80 ms | 86 ms    |
| The same read under sudo, so no rule runs  | 72–73 ms | 72–75 ms |

A read where a rule runs is about 10% slower. A read where none does costs nothing measurable, and that depends on `checkRowRead` staying synchronous when there is no rule to run: it is called for every field on every row, and as an `async` function it added about 10% to a sudo read on its own.

In isolation, a scalar rule goes from 0.002 µs to 0.03 µs per evaluation, and a rule walking 5 related rows from 0.03 µs to 0.9 µs. A rule walking 1,000 related rows goes from 5 µs to 145 µs, because each row it touches is guarded in turn, so the cost follows what the rule reads rather than what the read fetched.
