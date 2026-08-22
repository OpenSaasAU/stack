# App-authored index declarations outrank better-auth-derived defaults

Status: accepted

When an application declares a model-level index on a derived auth list and that index covers the same column as an index the stack derived from better-auth's own table definitions, the **application's declaration wins**: the derived field-level `isIndexed` is suppressed for that column and only the app's entry is emitted. This is the opposite of the rule for app-declared lists, where a `db.indexes` entry colliding with a field's `isIndexed` is a config-time error.

## Context

"Auth lists derive from better-auth's own table definitions" (ADR-0033) established that the auth lists derive their shape from better-auth's own table definitions rather than a hand-maintained mirror. Emitting the indexes better-auth declares (#937) followed from that: each derived scalar field carries `isIndexed: true` / `isIndexed: 'unique'` mapped from the upstream `index` / `unique` flags. `User.email` is therefore `@unique` with a Prisma-derived constraint name, automatically and unconditionally.

Separately, the generator rejects a `db.indexes` entry that duplicates a column a field-level `isIndexed` already indexes. That guard is correct for a list the application wrote: both declarations are the author's, one of them is redundant, and erroring is cheaper than silently picking a winner.

The guard becomes wrong the moment one of the two declarations is derived rather than authored. Two app needs collide with it directly:

- Adopting a live constraint **name** on a derived column (#921). A live better-auth installation's `user.email` constraint may be named anything; Prisma derives `User_email_key`. Expressing the real name requires a named single-column entry on a column that now always carries a derived `isIndexed` — which the guard rejects, leaving the app no way to say it.
- Extending a derived column into a **composite** index (#985), where the app's `(identifier, createdAt)` index overlaps a column better-auth already indexes on its own.

In both cases the app knows something the stack cannot: what the live database actually contains. A derived default is the stack's best guess in the absence of that knowledge, and a guess should yield to a fact.

## Considered options

- **App entry suppresses the derived `isIndexed` for the columns it covers (chosen).** The app declares the constraint it wants; the stack stops emitting its own for that column. One index per column, no error, and the adoption cases become expressible. Consistent with ADR-0013's principle read one level up: the application authors the config and the plugin is the conduit — that applies to schema knobs (`tableName`, `fields`, `schema`, and now `indexes`) exactly as it applies to access.
- **Keep the error.** Rejected: it makes #921 unsolvable through this seam and forces a second, parallel mechanism for constraint-name adoption. It also asks the application to "remove one of them" when one of them is derived and therefore not the application's to remove.
- **Override, but warn on every generate.** Rejected: the divergence is a deliberate, permanent config choice, not a mistake. A warning that fires forever on correct configuration trains people to ignore warnings.
- **Merge without suppression (emit both).** Rejected: two indexes on the same column is a schema defect, and on the `unique` path the two constraints can disagree.

## Consequences

- **Suppression is per-column, not per-list.** An app entry covering `email` suppresses the derived `isIndexed` on `email` only; every other derived index on that list still emits. An app declaring a composite `(identifier, createdAt)` suppresses the derived single-column index on `identifier` — which is the intent, since the composite serves the same lookups.
- **The application can now emit a schema better-auth would not.** Suppressing a derived `unique` in favour of a non-unique entry is expressible, and would break better-auth's own assumptions. This is accepted: the seam exists for apps adopting a live database, and an app that lies about its live database gets the schema it described. The failure surfaces at `migrate diff` against the real table, which is where it belongs.
- **The rule is scoped to derived lists.** For lists the application declares itself, the existing collision error stands unchanged — there is no derived declaration to yield, so both entries are the author's and the error is still the right call.
- **Plugin-derived tables are not covered.** They carry no app-facing config surface to declare indexes through ("Plugin tables derive through the same registry as the base auth models", ADR-0034); extending this seam to them is separate work.
