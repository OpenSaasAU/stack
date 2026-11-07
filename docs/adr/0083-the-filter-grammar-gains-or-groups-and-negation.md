# The filter grammar gains OR groups and negation

ADR-0017 kept the filter grammar AND-only, on the promise that OR, grouping and negation could arrive later without changing the meaning of any existing URL. That promise was wrong: every one of those constructs is free text today, so `(a OR b)` searches for three words and `-status:draft` searches for itself. We are adding them anyway, and accepting that break openly, because an admin list that cannot say "drafts, or anything of Priya's" cannot surface the exact rows its user wants, and the project has no consumers holding bookmarks. This supersedes the AND-only commitment in ADR-0017; its "unknown syntax degrades to free text" rule stands and is extended below.

A query is an AND of terms, where a term is a Filter token or an OR group. The additions are:

| Syntax                 | Meaning                                               |
| ---------------------- | ----------------------------------------------------- |
| `(a OR b)`             | An OR group. The keyword is uppercase                 |
| `-field:value`         | Negation: is not, or does not contain                 |
| `field:a,b`            | Any of these values                                   |
| `field:!` / `-field:!` | Is empty / is not empty, on a field that can be empty |
| `field:a..b`           | An inclusive range, as one token                      |
| `field:#id`            | The related record with exactly this id               |
| `\"`                   | A literal quote inside a quoted value                 |
| `\\`                   | A literal backslash inside a quoted value             |

Literal text stays reachable by quoting, so `"OR"` and `"(draft"` are still free-text searches.

## Considered Options

**Nesting.** Groups do not nest, so `(A and B) or C` cannot be written. A chip bar cannot show arbitrary depth, and every construct we ship must parse identically forever. Nested parentheses degrade to free text, which leaves room to add nesting without changing what any accepted URL means.

**Comma lists.** `status:a,b` says the same thing as `(status:a OR status:b)`, so it is a second spelling forever. We kept it because "any of" on one field is the commonest complex filter and deserves one chip.

**`field:empty`.** Rejected because a real value can be called "empty". `!` cannot collide with a value a user means, and it negates to `-field:!` with no further syntax.

**Relative dates.** Rejected for now. A preset such as "last 30 days" writes absolute dates, so a stale bookmark looks stale rather than quietly moving.

## Consequences

- The engine composes negation and any-of around each field's existing condition, so a Filter spec gains only the ability to say what empty means, and a third-party field gets both for free.
- "Is not" includes empty rows. SQL would silently drop them, which is never what an admin looking for everything except Product means.
- A token that cannot map is never dropped and never negated. Inside an OR group it stays in place as a free-text alternative, because dropping it would change the results. A negated one stays the literal word `-secret:x`, because `NOT (free text)` would turn a field the session cannot read into a filter.
- Unmatched or nested parentheses degrade to literal words.
- Core owns the tree, parser and serialiser, and parse-then-serialise is a true inverse. The admin UI carries no grammar of its own.
- Filtering can still only narrow: the query is ANDed with the Access Filter however it is built.
