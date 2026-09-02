# No key reaches the ORM that the Access Filter has not scoped

Status: accepted

> **No key reaches the ORM that the Access Filter has not scoped, and none that key validation has not resolved.**

Read the two clauses by what each names, not as one requirement doubled. Scoping is a question only a relation-bearing key raises — whose rows come back — so the first clause binds relation keys on the read path, where the Access Filter is the mechanism that answers it. Every key, relation or scalar, on either path, is checked against the list config before it reaches the ORM at all — the second clause, and the one an ordinary scalar write satisfies without ever touching the Access Filter, because there is nothing about a scalar to scope.

This is not a new decision. The write path already satisfies it: an undeclared key in `data` fails closed in `filterWritableFields`, and a synthetic back-relation key resolves through `resolveSyntheticReverseRelation` to the declared relationship field that owns it before the normal access/hooks machinery runs on it (see Synthetic back-relation, CONTEXT.md). The read path satisfies it for top-level `where`/`orderBy` (#912, #915, #916). What this record adds is a name — the rule was previously nowhere, so each place it went unenforced elsewhere had to be rediscovered rather than checked against a standing statement.

**#566 is this rule's own prior art**, for the one path it names explicitly: a caller-supplied `include` replacing the access-controlled include wholesale, rather than being merged with it. Its framing is the one every later instance re-raises — the API was "safest when used naively and unsafe when used deliberately," inverted from what a caller expects. #566 fixed that one path. Nothing recorded the principle behind the fix, which is why the same shape of gap kept reappearing under different keys.

## The instances

Four issues, discovered while triaging one another, turned out to be the same root cause reaching the ORM through a different key or a different path:

| Issue | Instance                                                                                                                                                        | Status at time of writing |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| #1082 | A synthetic back-relation (`from_<List>_<field>`) named in `include` was neither validated nor scoped                                                           | Closed (#1091)            |
| #1087 | A caller-supplied `_count` in `include` is unscoped, so counts include rows the session cannot see                                                              | Open                      |
| #1088 | A fragment read (`{ query: fragment }`) skips the Access Filter's scoping walk entirely — related-list query access, row filters and the depth cap all bypassed | Open                      |
| #1092 | A `where`/`orderBy` nested inside an `include` entry is never key-validated, on either read path                                                                | Open                      |

This record is deliberately not blocked by any of them landing. An ADR states a decision, not a completed state, and stating the rule while three instances remain open is the point — it gives each of them, and any future instance, one place to be checked against rather than re-derived.

## What this record situates, rather than restates

Three existing records each assumed this rule without stating it, and this is the statement they were missing:

- **ADR-0001** keeps operation-level `query` access in the pre-query Access Filter and field visibility in the post-query Field Visibility phase. That split only holds the guarantee it's meant to if every key a caller can put in front of the pre-query phase actually reaches it — a key that skips the phase (a fragment selector, an unrecognised `include` entry) is a hole in the boundary ADR-0001 draws, not a case it considered.
- **ADR-0022** decided that failing to compute a scope is a denial, never a passthrough, for the case it had in front of it — an `include` nested deeper than the depth cap. The instances above are the same failure mode at a different cause: not "too deep to scope" but "never offered to the scoper at all." The posture is the same; this record generalises what triggers it.
- **ADR-0031** closed the predicate-level probing oracle for a caller's top-level `where`/`orderBy`, by denying a key the session cannot read rather than silently narrowing or throwing inconsistently. #1092 is that identical oracle one hop down, at a `where` nested inside an `include` entry that never reaches the checker ADR-0031 built.

None of those three records is amended here — each was correct about the surface it covered. This record is the general form underneath them, so a fifth instance has a rule to be checked against instead of a fourth ADR to be re-derived from.

## Mechanism-neutral with respect to the Prisma 8 secured surface

This record does not mandate whether the future contract module emits an unreferenced back-relation at all, or which construct is responsible for enforcing the rule on the new surface. Whether Prisma 8's builder requires an opposite field on the related side is currently unverified — ADR-0040 records the CLI as broken at the relevant release candidate, so a mechanism-specific mandate here would risk being wrong in one direction or the other once that's checked. The rule itself — no key reaches the ORM unscoped, none reaches it unvalidated — has to hold regardless of which shape the synthetic-key problem takes under the new generator, or whether it exists there at all.

## Consequences

- CONTEXT.md's **Access Filter** entry is amended so its denial rule visibly covers a key the list config never declared, not only a caller include the phase could not scope for depth reasons. It previously read as though the undeclared-key case was already handled, which is how the gap survived review across four separate issues.
- This changes no runtime behaviour and fixes none of the four instances — each is fixed under its own issue, against this rule.
- No package under `packages/` is modified, so no changeset accompanies this record.
