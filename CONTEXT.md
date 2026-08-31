# OpenSaas Stack

Config-first stack for admin-heavy Next.js applications, whose defining feature is an access-control engine that automatically secures every database operation.

## Language

### Access control

**Operation-level access**:
A check that gates whether a session may perform an action (query/create/update/delete) on a list, returning either a boolean or a Prisma filter that scopes which rows are visible.
_Avoid_: list access, row access

**Field-level access**:
A check that gates whether a session may read or write a single field, returning a boolean only. Cannot scope rows — a denied field is removed, not used to exclude records.
_Avoid_: column access, property access

**Predicate-time read check**:
A field-level `read` rule evaluated BEFORE the query runs, against a key named in a caller's `where`/`orderBy`, rather than against an already-fetched row — the check that stops a field's withheld value or relative order from being recovered by probing a query that returns no rows containing it (e.g. `count()`). There is no row yet at this point, so a rule that depends on one (dereferences `item`) cannot be answered and resolves to a denial rather than being skipped (ADR-0031).
_Avoid_: filter access check, where validation

**Access Filter** (pre-query phase):
The first pass of a read, run before the database is hit. Uses operation-level access to build the access-scoped `include`/`where` so the database only returns rows and relations the session is allowed to see. It scopes the relations a read asked for, and leaves out one the session may not read at all when that can be decided without a row; otherwise it does not choose which relations a read fetches (see Bare read). Leaving one out is a saving, never the decision — Field Visibility checks every relation it is handed regardless (ADR-0044). Failing to compute a scope is a **denial**, never a passthrough: a caller-supplied `include` nested deeper than the phase can scope throws rather than returning unscoped rows (ADR-0022). This is distinct from having nothing to scope — a list with no relationships — which passes through unchanged.
_Avoid_: query builder, include builder

**Field Visibility** (post-query phase):
The second pass of a read, run on the returned rows. Removes fields the session cannot read and produces the value of every computed field the read is going to return — so a computed field on a Bare read arrives from here, not from the query. A field the read will not return does no work here at all — neither its read check nor its computation — so this phase costs what the read asked for rather than what the list happens to define. Running a hook extends the read's resolve chain, which bounds how far a hook-issued read may re-enter this phase.
_Avoid_: result filter, output filter, field stripper

**Resolve chain**:
The sequence of `resolveOutput` hooks a read has entered on the way to a value — a hook that issues its own read extends the chain with that read's hooks. A top-level read starts an empty chain, and each hook's chain is its own: two hooks running concurrently never see each other's. A chain may not repeat a (list, field) pair, because a hook that re-enters itself cannot terminate; that is refused loudly. Chain length is bounded separately, as a cost limit only.
_Avoid_: hook chain (that is plugins composing hooks), resolveOutput depth, recursion depth

**Bare read**:
A read that names no relations. It returns the row's own columns and never its relations — the ORM's own behaviour for the same call, not something this codebase adds (ADR-0043). Computed fields come back on top of it, from Field Visibility. The rule holds for every read: single, many, and singleton, whether or not access control is being bypassed. Related data is always something a read asks for, so a call site's shape is readable from the call site.
_Avoid_: auto-include, default include, unqualified read

**One hop**:
The reach of naming a relation: it fetches that relation's own columns and stops, so reaching further means naming further. This is the Bare read rule at every level rather than only at the root — a read describes the tree it returns, one level at a time, and no part of that tree arrives because the engine went looking for it. The ORM enforces it (ADR-0043), and it holds for every relation a caller can name: where the ORM could not reach one, the field is refused at generation rather than the rule gaining an exception. How far a caller may reach is a separate cost limit, refused loudly.
_Avoid_: deep include, nested expansion, relation tree

**Projection**:
A caller's statement of which fields it wants back, at each level it names — the reciprocal of One hop, which says how far naming reaches. A projection may be narrower than a Bare read as easily as wider, since it selects the row's own fields too, and what it selects is what gets computed. Where a projection crosses a trust boundary the reachable vocabulary is published ahead of the request and anything outside it is refused, so a caller can tell what it may ask for without asking.
_Avoid_: include, field mask. (`select` is the ORM's spelling of this term, honoured exactly — the word is fine; what it names is narrower than the term.)

**Computed field**:
A field whose value is produced rather than read straight from storage — one with no column of its own, or one that transforms what its column holds. It is produced only where the read is going to return it, and it sees its own declared dependencies and the system fields, never another computed field's value and never whatever else the caller happened to select. Reaching for either finds nothing there, so no two computed fields can depend on the order they were declared in, and no field's value can change because of how a call site shaped its read.
_Avoid_: virtual field (that names one kind, not the category), derived field, resolver

**Declared dependency**:
A stored column or a relation a computed field names as an input it cannot compute without. The read fetches it for the field's benefit wherever that field is computed, and does not return it — a declared dependency never widens what a caller receives, so a call site's shape stays readable from the call site (see Bare read). It is fetched exactly where the field is computed and nowhere else, so a read pays for a dependency precisely when it pays for the field that named it. Declaring it is what earns the data: a computed field that reaches for anything it did not declare finds nothing there, including when some other field's declaration, or the caller's own projection, happened to fetch it. A declaration is also what the field is owed rather than what the caller is owed, so it outranks a rule denying the caller read access to the same column or relation — the value reaches the hook and is still stripped before the caller sees it.
_Avoid_: auto-include, eager load, field dependency, prefetch

**Declared dependency set**:
Everything one computed field declares, resolved once at generation time and emitted for the engine to read rather than worked out per read. It reaches exactly one hop and does not compose: a declared relation delivers its rows' stored columns, and no computed field runs on a branch the caller never receives, so nothing on that branch declares anything further. A read widens its projection by the union of the sets belonging to the fields it is about to compute, and strips the difference before returning. Because widening never triggers another computation, a set cannot cycle and cannot outgrow the read-include depth cap, which bounds the caller's own tree and exempts the widening.
_Avoid_: declaration closure (it asserted a transitivity this does not have), dependency graph, needs chain, include tree

**Session-relative value**:
A computed field's value reflects exactly the rows the reading session may see, never more — down to and including none of them. A total over a relation the Access Filter scoped is a projection of the visible rows, not a fact about the underlying row; computing the true figure would leak the values of rows the session was denied. A field always computes, on whatever its session can see, so one that declares two dependencies and is granted one still produces a value; reconciling that with what the field means is the field author's job. A field that genuinely needs the unscoped view has to ask for it explicitly, through a privileged read inside its own hook.
_Avoid_: filtered total, partial value, true value

**Silent failure**:
The convention that an access-denied operation returns `null` (single) or `[]` (many) rather than throwing, so callers cannot distinguish "denied" from "does not exist". A denial is atomic with the result it replaces — a caller never receives part of a read that was refused, which is why a read arrives whole rather than a row at a time (see Terminal operation).
_Avoid_: access error, permission error

**Engine stamp**:
A mark the access engine puts on every query it builds, and the only thing the ORM-level tripwire reads. It carries no session and no policy — it answers one question, "did this query come through the secured engine?", which is what lets a query the engine never saw be refused before it compiles (ADR-0038). Because it says nothing about _who_ is reading, scoping a query to a session stays an ordinary rebind and needs no ambient per-request storage. The mark is written inside the terminal, never at an application call site, and the tripwire that reads it is stack-owned rather than configured — the two are one component that is removed together or not at all (ADR-0049).
_Avoid_: query tag, session token, middleware context

**Unsafe surface**:
The deliberately unsecured ORM client, reached under a name that states the bypass. It carries neither access control nor hooks, and it stamps the ORM queries it builds as intentionally unscoped, so a bypass is an audited act rather than an absence indistinguishable from a mistake. Better-auth's own flows and vector search run here by design (ADR-0013, ADR-0038); an ORM query bearing no stamp at all belongs to neither surface and is refused. **Raw SQL is outside this entirely** — raw plans never reach the tripwire, so they are neither stamped nor refusable, and scoping them is the caller's alone.
_Avoid_: raw client, escape hatch, prisma passthrough

**Extension pack**:
A bundle of database capability — column types, codecs, typed operations — contributed by a package and named in `db.extensions` as an import descriptor (`{ name, from }`) rather than as a value, so the generated contract can import it itself. Declaring one is a contract-level act only: it makes `Vector(n)` a column type the schema can use, and does not install the Postgres extension, which stays the deployment's job. A pack may be declared by the application or contributed by a plugin that knows it needs one; a field whose type names a pack the config does not declare fails generation (ADR-0049).
_Avoid_: preview feature, database extension, plugin, adapter

**Terminal operation**:
The operation that executes a built-up query and the only place a read or write is secured — it resolves operation-level access, merges the access filter, and applies Field Visibility to what comes back. The query itself is an immutable value that can be composed anywhere; nothing about it is enforced until a terminal runs it. Silent failure lives here, which is why the terminals stay the engine's and are never delegated to the ORM (ADR-0039). A terminal yields its rows all at once and never one at a time, so a refusal — including one raised part-way through securing the rows — reaches the caller before any row does; bounding a large read is the caller's job, and a read that must be consumed incrementally belongs on the Unsafe surface (ADR-0046).
_Avoid_: executor, query runner, resolver, stream

**Row lock**:
A `SELECT … FOR UPDATE` taken through the secured surface, reachable only on a transaction-bound builder because outside a transaction it is a silent no-op. It is the stack's concurrency gate now that no isolation level can be selected (ADR-0042): the contended parent row is locked as a **mutex token** — every racer takes the same token before reading the count it will branch on — rather than as protection for that row's own columns. The engine issues it as a second statement over the primary keys the scoped read returned, always ordered by primary key, so the locked set is provably a subset of the readable set and acquisition order is the same in every session (ADR-0047). A terminal never returns a row it did not lock.
_Avoid_: pessimistic lock, select for update, transaction lock

**Connect**:
The only relationship spelling a write payload accepts (`author: { connect: { id } }`), legal **only on the field that owns the foreign key**. There it is engine-owned sugar for a **foreign-key assignment**, not a nested write: the terminal issues a reachability query for the target and then writes the scalar column, both statements carrying the engine stamp. Assigning `null` to the same field is its counterpart, and replaces what nested `disconnect` used to spell. It requires read/query access on the target row _and_ the owning relationship field's write access, so a foreign key can never become a probing oracle. On any non-FK-owning field — an inverse to-many, the non-owning side of a one-to-one, or a junction list — it is a **generation error**, because there it would be N secured writes against another list wearing one field's name (ADR-0050).
_Avoid_: nested connect, link, attach

**Write Pipeline**:
The single module that runs the canonical, secured write sequence (operation-level access → hooks → validation → writable-field filtering → relationship resolution → persistence → after-hooks → Field Visibility) for one create/update/delete. Operation-level access is resolved first, outside the transaction (#590) — a denied write short-circuits to `null` before any hook fires. Owns the phase order in one place; per-operation differences (target resolution, which input phases run, the database verb and returned row) are supplied by a per-operation strategy.
_Avoid_: operation handler, mutation service

**Hook Pipeline**:
The module that runs the transform+validate span of a write — list `resolveInput` → field `resolveInput` → list `validate` → field `validate` → built-in field rules → split multi-column fields — owning that order and the `resolvedData` threading through it. It throws a validation error (never silent) when a validate hook reports via `addValidationError` or a built-in field rule fails, and returns the transformed `resolvedData` on success. A multi-column field (e.g. storage `image()`/`file()` in Keystone-parity mode) is validated under its logical field key BEFORE it is split into its per-part physical columns, so an unrecognised value throws instead of being silently split into null/undefined columns (#789). The Write Pipeline delegates this span to it; side-effect hooks (`beforeOperation`/`afterOperation`), access, writable-field filtering, persistence and Field Visibility stay in the Write Pipeline.
_Avoid_: validation service, input resolver

**In-transaction hooks** (`beforeOperation` / `afterOperation`):
Side-effect hooks that run _inside_ the write's database transaction and roll back with it — for work that must be atomic with the write (typically DB work through the transaction client). They fire once per record written. Since ADR-0050 removed nested relation input there is only one call shape, so hook parity across shapes is true by construction rather than by machinery.
_Avoid_: operation hooks (ambiguous about the boundary)

**Transaction-boundary hooks** (`beforeTransaction` / `afterTransaction`):
Side-effect hooks that run _outside_ the write's database transaction, for non-transactional work (e.g. external API calls) that must not hold the transaction open. `beforeTransaction` runs before its write; `afterTransaction` runs when the outermost transaction the write participates in settles, and **always** runs — reporting whether that transaction committed or rolled back — so the pair forms a compensation bracket around the atomic write. Like the in-transaction hooks, they fire per list involved in the write — since ADR-0050 that is exactly one list per write, and a caller writing several lists does so through **Transaction owner**'s `context.transaction()`, where each write brings its own bracket.
_Avoid_: outer hooks, outbox hooks

**Joined write**:
A `context.db` write that runs inside a transaction it did not open, because the client it was handed exposes no way to open one. Arises both inside an interactive transaction and from a hook writing through the context it was given.
_Avoid_: nested write (ADR-0050 removed that sense from the write surface; do not revive it here), inner write

**Transaction owner**:
The component that opened the transaction a write participates in, and so the only one that knows when it settles. A joined write's transaction-boundary hooks report the outcome its owner observed.
_Avoid_: transaction opener, transaction root

**Unowned join**:
A joined write with no transaction owner — the stack did not open the enclosing transaction and cannot observe its settle, as when an application manages its own transaction or a test double cannot open one. Its `afterTransaction` reports optimistically at write time, the one case where the outcome is not a fact.
_Avoid_: orphan write, detached write

### Migration & schema generation

**Schema parity**:
The property that the generator's Prisma schema diffs clean — an empty `prisma migrate diff` in both directions — against a pre-existing (typically Keystone-generated) database, so a project can adopt the stack without a destructive migration. It is the go/no-go gate for every migration phase.
_Avoid_: schema match, clean diff, byte-compatibility

**Keystone-compat mode**:
An opt-in generator setting that makes schema output follow Keystone 6 conventions a migrating project depends on but a greenfield project would not want by default (e.g. non-null text columns defaulting to `""`). Conventions that every project wants are the plain default, not part of this mode.
_Avoid_: legacy mode, compatibility flag, migration mode

### Code generation

**Contract module**:
The TypeScript `defineContract` source the generator emits from `opensaas.config.ts` — the replacement for the generated Prisma schema, and the single declared source of truth for the database's shape. It is **standalone and fully literal**: it imports nothing from the app config, so the builder's purity rules (no env, clock, random, or side effects; no functions, class instances or `Date`) hold by construction rather than by discipline. No PSL is emitted alongside it (ADR-0040).
_Avoid_: generated schema, schema.prisma, contract source

**Contract artifacts**:
The `contract.json` + `contract.d.ts` pair that `prisma contract emit` produces from the Contract module. Both are committed and diffable, emission is byte-deterministic, and the type artifact carries what the stack used to derive by hand — read and write field shapes, per-field nullability and codec, the domain-to-column mapping, and the relation graph with cardinality. They are generated: changing them means changing the Contract module and re-emitting.
_Avoid_: contract file, emitted schema, generated types

**Generated bundle**:
The `.opensaas/` directory the generator emits from `opensaas.config.ts` — the `getContext`/`config` factory plus the Prisma client tree. Its imports are only relative paths and npm packages, never the host app's path aliases; the bundle's own loadability in a given runtime is the stack's concern, while what the app's `opensaas.config` reaches (and so drags into the load) is the app's.
_Avoid_: generated context, output dir, .opensaas folder

**Node build**:
A compiled, plain-Node-loadable form of the Generated bundle, emitted _in addition to_ the default bundler form so a live module (e.g. the auth path) can be imported in a runtime that has no bundler — plain Node, a Playwright e2e helper, a build-time script. Opt-in per `output: { buildTarget: 'node' }`; absent it, only the bundler form is emitted. Distinct from the default bundler form, which is loaded by the host's bundler and is the stack's standing default.
_Avoid_: compiled bundle, dist build, mjs build, node bundle

### Authentication

**Auth lists**:
The user/session/account/verification lists the auth plugin derives from the better-auth config — their keys, table/column maps, and database schema all follow that config, so they can be modelled to match (adopt) pre-existing better-auth tables. Distinct from any application domain User.
_Avoid_: auth tables, auth models, auth schema

**Auth identity**:
The better-auth-owned record of who a session belongs to (the better-auth user). Separate from, and not assumed to be, the application's own domain User; an app links the two itself when it needs to.
_Avoid_: auth user, principal, account

**Auth action**:
An app-owned `'use server'` function that runs an authentication mutation (sign in, sign up, request/perform password reset, social sign-in) by calling better-auth's server API directly against the app's own auth instance. The pre-built auth forms invoke Auth actions passed as props — one prop per concern — instead of the browser calling the `/api/auth/*` endpoints; the auth instance therefore never leaves the server, and the package owns only the form components and the actions' contract types, never the actions themselves.
_Avoid_: auth handler, form action, authClient call

### Storage

**Storage provider**:
A backing store for `image()`/`file()` assets — local disk, S3, Vercel Blob, or a custom one — implementing the common provider interface. Each provider ships as its own package so its SDK stays an optional dependency, pulled in only by apps that use it.
_Avoid_: storage backend, storage adapter, uploader

**Provider registry**:
The lookup from a configured provider `type` to the constructor that builds it, which the storage runtime consults instead of a closed `switch`. A host registers the (optional) provider packages it uses, so non-`local` and custom providers are constructable without the runtime depending on every provider's SDK.
_Avoid_: provider switch, provider map, plugin registry

### Website & docs

**Stack** (public name):
The product's name in public-site copy and the wordmark, attributed "by OpenSaas". Package names (`@opensaas/stack-*`) and the GitHub org keep their full names; only the public voice shortens.
_Avoid_: OpenSaaS Stack (in site copy), the stack (as a name)

**Guardrails story**:
The site's core narrative: AI coding agents ship features fast but can't be trusted with security, so Stack makes the secure path the only path — access control enforced on every operation is the reason agent-built features can be trusted. Speaks to developers already building with AI agents; names Claude Code as the first-class workflow, not the headline.
_Avoid_: AI story, marketing angle, Claude Code story

**Narrative landing**:
The single public page that tells the Guardrails story as one scroll — pain, turn, proof, how it works, get started. All other public content lives in the docs.
_Avoid_: marketing site, homepage (ambiguous with the docs landing)

**Session switcher**:
The Narrative landing's interactive proof block: one config and one query with the requesting session switchable (anonymous / author / other user), showing rows being scoped and Silent failure happening. Runs on precomputed results and says so — it demonstrates, it does not execute.
_Avoid_: live demo (it isn't one), playground

**Docs quadrants**:
The Diátaxis organization of the docs — Tutorials, How-to guides, Concepts, Reference — where every page has exactly one of those four jobs. Concepts carry this glossary's vocabulary; per-package pages are Reference.
_Avoid_: docs sections, categories

**Flagship tutorial**:
The learning-path tutorial anchoring the Tutorials quadrant: build a small real app by describing features to Claude Code, punctuated by Checkpoints.
_Avoid_: quick start (that's setup), walkthrough

**Checkpoint**:
A canonical config snapshot inside the Flagship tutorial that re-anchors the reader ("your config should now look like this") regardless of what the agent generated along the way — the device that keeps an agent-driven tutorial truthful.
_Avoid_: step, milestone

### Admin UI

**Label field**:
The field a list uses to represent its rows as a single value — resolved by `getLabelFieldName` from `ui.labelField` (when configured and pointing at a declared, non-relationship field) or the fallback order `name` → `title` → `id`. The single source of truth so the field chosen for projection can never drift from the field used for rendering.
_Avoid_: display field, title field, name field (the fallback happens to check a field called `name`, but the concept isn't tied to that key)

**Item label**:
The rendered text for one row, produced by `getItemLabel` reading the Label field off that row and falling back to `id` when the field is missing (e.g. stripped by field-level access). Used anywhere the admin UI shows a row as a reference — relationship cells, dropdown options, page headings.
_Avoid_: display value, row label

**Theme token**:
A named visual variable — a colour, font family, radius, or shadow — that forms the admin UI's single theming contract: components consume only tokens, and every customization layer writes to them.
_Avoid_: CSS variable (the mechanism, not the concept), design variable

**Theme preset**:
A named, curated assignment of values to every Theme token, selectable as a starting point and overridable per token.
_Avoid_: skin, theme (ambiguous with the whole token set)

**Slot**:
A stable, named styling handle on one rendered part of an admin UI component, kept as a compatibility promise so custom styling can target that part without forking the component.
_Avoid_: CSS hook, part, element selector

**Admin chrome**:
The persistent shell the admin UI wraps around list and item content — navigation, page headers, user menu, dashboard framing.
_Avoid_: layout, shell, frame

**Chrome slot**:
The seam through which a host application supplies its own Admin chrome, replacing the built-in sidebar wholesale while the admin keeps ownership of routing, the page shell, and content rendering. Supplied at the mount site, never through config — host navigation is the host's routing, not shared schema, and config cannot carry React icons (ADR-0021).
_Avoid_: custom nav, chrome override, sidebar prop

**Nav item**:
One entry in the Admin chrome's sidebar. Built-in items are derived from the config's lists and singletons; host-supplied items are contributed through the Chrome slot's children region and render with the same active state, icon slot, count badge, and Slot contract as built-in ones.
_Avoid_: nav link (that's the component), menu entry, sidebar item

**Filter builder**:
The list view's single query input that turns a typed query into scoped, server-executed filtering. Filter state lives in the URL, so a filtered view is shareable and survives refresh; filtering always runs through the secured context so access control is never bypassed.
_Avoid_: search bar (that's the free-text subset), query builder

**Filter token**:
One parsed unit of a filter query — a field, an operator, and a value — displayed as a removable chip. The v1 grammar is AND-only: tokens combine conjunctively, values with spaces are quoted, numeric/date fields take comparison operators, and a bare word is free-text search across text-searchable fields.
_Avoid_: filter chip (the chip is the rendering, not the concept), predicate

**Filter spec**:
A field's self-declared filtering capability: which operators it supports, how a token maps to a query condition, and what the suggestion dropdown may offer for it (enumerated values for closed fields, label search for relationships, structure only for unbounded fields — never data-derived values). A field without a Filter spec is not filterable and never suggested. A relationship's Filter spec is pure (it cannot itself resolve access control), so its nested condition — a to-one's `is` label match or a to-many's count marker — is resolved into an access-scoped equivalent (the related list's `query` access ANDed in, or a never-match when denied) before the query runs, keeping the "never bypassed" guarantee true for nested relationship conditions too (issue #749).
_Avoid_: filter config, operator list

**Bulk action**:
An operation applied to an explicitly selected set of rows in a list view. Delete is the only built-in, shown only when the session's access allows it and honouring Silent failure per row; every other bulk action is list-specific, declared in that list's config, and runs server-side with the secured context. Selection is always an explicit set of row ids — accumulated across pages, cleared when the filter changes — never "everything matching the filter".
_Avoid_: batch operation, mass action

**Cell**:
The list-table rendering of one field's value, resolved through the same priority chain as form field components (per-field override → custom type registry → field-type registry → plain text). Each field type ships its own default cell, so a third-party field's values render correctly in tables without core changes.
_Avoid_: column renderer, formatter

**Relationship table**:
The edit view's rendering of a to-many relationship as a table of the related list's rows. Its columns default to the related list's own column curation (minus the back-reference to the parent), its cells are the related list's Cells, and every edit in it is an operation on the related list — subject to that list's access control, never the parent's. Removing a row disconnects by default; true deletion is an explicit per-relationship opt-in.
_Avoid_: nested table, child table, sub-list

**Inline cell edit**:
Editing a single field of a row directly in a Relationship table cell: commit on Enter or blur, cancel on Escape, applied optimistically and reverted — with the reason shown — when the write comes back as a Silent failure or a validation error. Fields the session cannot write never show the edit affordance.
_Avoid_: in-place edit, quick edit
