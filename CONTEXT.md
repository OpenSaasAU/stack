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

**Access Filter** (pre-query phase):
The first pass of a read, run before the database is hit. Uses operation-level access to build the access-scoped `include`/`where` so the database only returns rows and relations the session is allowed to see.
_Avoid_: query builder, include builder

**Field Visibility** (post-query phase):
The second pass of a read, run on the returned rows. Removes fields the session cannot read, runs `resolveOutput` hooks, and computes virtual fields.
_Avoid_: result filter, output filter, field stripper

**Silent failure**:
The convention that an access-denied operation returns `null` (single) or `[]` (many) rather than throwing, so callers cannot distinguish "denied" from "does not exist".
_Avoid_: access error, permission error

**Write Pipeline**:
The single module that runs the canonical, secured write sequence (hooks → validation → operation-level access → writable-field filtering → nested operations → persistence → after-hooks → Field Visibility) for one create/update/delete. Owns the phase order in one place; per-operation differences (target resolution, which input phases run, the database verb and returned row) are supplied by a per-operation strategy.
_Avoid_: operation handler, mutation service

**Hook Pipeline**:
The module that runs the transform+validate span of a write — list `resolveInput` → field `resolveInput` → list `validate` → field `validate` → built-in field rules → split multi-column fields — owning that order and the `resolvedData` threading through it. It throws a validation error (never silent) when a validate hook reports via `addValidationError` or a built-in field rule fails, and returns the transformed `resolvedData` on success. A multi-column field (e.g. storage `image()`/`file()` in Keystone-parity mode) is validated under its logical field key BEFORE it is split into its per-part physical columns, so an unrecognised value throws instead of being silently split into null/undefined columns (#789). The Write Pipeline delegates this span to it; side-effect hooks (`beforeOperation`/`afterOperation`), access, writable-field filtering, persistence and Field Visibility stay in the Write Pipeline.
_Avoid_: validation service, input resolver

**In-transaction hooks** (`beforeOperation` / `afterOperation`):
Side-effect hooks that run _inside_ the write's database transaction and roll back with it — for work that must be atomic with the write (typically DB work through the transaction client). They fire per record written, including each nested record, so a record's side effects are identical whether it was written top-level or nested.
_Avoid_: operation hooks (ambiguous about the boundary)

**Transaction-boundary hooks** (`beforeTransaction` / `afterTransaction`):
Side-effect hooks that run _outside_ the write's database transaction, for non-transactional work (e.g. external API calls) that must not hold the transaction open. `beforeTransaction` runs before the transaction opens; `afterTransaction` runs after it settles and **always** runs — receiving whether the transaction committed or rolled back — so the pair forms a compensation bracket around the atomic write. Like the in-transaction hooks, they fire per list involved in the write (including nested lists).
_Avoid_: outer hooks, outbox hooks

### Migration & schema generation

**Schema parity**:
The property that the generator's Prisma schema diffs clean — an empty `prisma migrate diff` in both directions — against a pre-existing (typically Keystone-generated) database, so a project can adopt the stack without a destructive migration. It is the go/no-go gate for every migration phase.
_Avoid_: schema match, clean diff, byte-compatibility

**Keystone-compat mode**:
An opt-in generator setting that makes schema output follow Keystone 6 conventions a migrating project depends on but a greenfield project would not want by default (e.g. non-null text columns defaulting to `""`). Conventions that every project wants are the plain default, not part of this mode.
_Avoid_: legacy mode, compatibility flag, migration mode

### Code generation

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
