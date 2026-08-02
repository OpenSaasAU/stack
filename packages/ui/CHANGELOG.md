# @opensaas/stack-ui

## 0.37.0

## 0.36.0

## 0.35.0

## 0.34.0

## 0.33.0

### Minor Changes

- [#829](https://github.com/OpenSaasAU/stack/pull/829) [`7158905`](https://github.com/OpenSaasAU/stack/commit/71589058b6079f896e8c9cebca62727161493da5) Thanks [@borisno2](https://github.com/borisno2)! - Add an admin chrome slot for host-supplied navigation (ADR-0021, issue [#823](https://github.com/OpenSaasAU/stack/issues/823)).

  `AdminUI` now accepts a `navigation` prop that replaces the built-in sidebar wholesale (skipping nav-count resolution), and a `navItems` prop that adds one or more links to the built-in sidebar's new children region:

  ```tsx
  // Add a link to the built-in sidebar
  <AdminUI {...props} navItems={[{ label: 'Back to App', href: '/' }]} />

  // Or replace the sidebar entirely
  <AdminUI {...props} navigation={<MyOwnSidebar />} />
  ```

  `NavLink` is now exported from `@opensaas/stack-ui` (with `active` and `icon` optional) so host-supplied entries render identically to built-in ones, and `deriveCurrentPath` is exported to derive the same `currentPath` `AdminUI` computes internally, for host-owned chrome that needs it.

### Patch Changes

- [#828](https://github.com/OpenSaasAU/stack/pull/828) [`ec5dc88`](https://github.com/OpenSaasAU/stack/commit/ec5dc8892bc6c6805545339ae6aefd273190a77d) Thanks [@borisno2](https://github.com/borisno2)! - Fix virtual fields rendering "Unsupported field type: virtual" in the Admin UI item view — they now display their resolved value read-only, and are never offered as an editable control or included in create/update payloads.

- [#827](https://github.com/OpenSaasAU/stack/pull/827) [`c79c556`](https://github.com/OpenSaasAU/stack/commit/c79c556198821e1a7288008e68c47cfe514fe0f2) Thanks [@borisno2](https://github.com/borisno2)! - Fix the admin item form fetching relationship options serially (N sequential round-trips before first paint). Fetches now run concurrently via `Promise.all`.

## 0.32.0

## 0.31.1

### Patch Changes

- [#798](https://github.com/OpenSaasAU/stack/pull/798) [`35bdbf3`](https://github.com/OpenSaasAU/stack/commit/35bdbf31c6ce2e303c9cd9ee2920dc473b718513) Thanks [@borisno2](https://github.com/borisno2)! - Fix Save failing on the edit page for any list with a `many: true` relationship table: strip the synthetic `_count` payload before it reaches the details form data, and harden `transformItemFormData` to drop any submitted key with no matching field.

## 0.31.0

### Minor Changes

- [#755](https://github.com/OpenSaasAU/stack/pull/755) [`9cd06dd`](https://github.com/OpenSaasAU/stack/commit/9cd06dddb45512966affc3a6b3455e97595c0de2) Thanks [@list({](https://github.com/list({)! - Admin chrome polish: opt-in nav counts and avatar label cells ([#735](https://github.com/OpenSaasAU/stack/issues/735))

  Two per-list opt-ins for the admin UI, both off by default.

  **Nav counts** — set `ui.navCount: true` on a list to show an access-scoped
  record count next to its nav item. The count is fetched through the secured
  context, so it only ever reflects what the current session may see; no count
  query runs for lists that don't opt in, and a list whose query access is
  statically denied renders no count rather than a misleading zero.

  ```typescript
  lists: {
    Post: list({
      fields: {
        /* ... */
      },
      ui: { navCount: true },
    }),
  }
  ```

  **Avatar label cells** — set `ui.avatar: true` to render a list's label column
  with a deterministic initials bubble ahead of the emphasized Item label. The
  initials and colour derive from the row; the palette is Theme-token-derived (no
  raw hex). A per-field cell override (`ui.cell`) on the label field still wins.

  ```typescript
  lists: {

      fields: {
        /* ... */
      },
      ui: { avatar: true },
    }),
  }
  ```

  New exports:

  - `@opensaas/stack-core`: `resolveNavCounts`, `isListQueryStaticallyDenied`
  - `@opensaas/stack-ui`: `Avatar` primitive, `AvatarLabelCell`, and the
    `getInitials`, `getAvatarTone`, `AVATAR_TONES` helpers. New Slots:
    `avatar`, `cell-avatar-label`, `nav-count`.

- [#759](https://github.com/OpenSaasAU/stack/pull/759) [`b190813`](https://github.com/OpenSaasAU/stack/commit/b190813a4531bd01b3206845b2c531099e0a204a) Thanks [@borisno2](https://github.com/borisno2)! - Add custom Bulk actions from list config (admin list view)

  A list can now declare list-specific Bulk actions under `ui.listView.bulkActions`. Each action's button renders in the list view's selection bar (in declaration order) alongside the built-in Delete. The action's server-side `handler` receives the selected ids and the secured context, so all its work runs through access control and hooks — a denied row is a Silent failure absorbed into the outcome, never leaked.

  ```typescript
  Post: list({
    fields: { title: text(), status: select({ options: [/* ... */] }) },
    ui: {
      listView: {
        bulkActions: [
          {
            key: 'publish',
            label: 'Publish',
            // Optional: `variant`, `destructive` (confirm first),
            // `hasAccess` (server-side visibility gate).
            handler: async ({ ids, context }) => {
              let n = 0
              for (const id of ids) {
                const updated = await context.db.post.update({
                  where: { id },
                  data: { status: 'published' },
                })
                if (updated) n++
              }
              return { message: `Published ${n} of ${ids.length}` }
            },
          },
        ],
      },
    },
  })
  ```

  Only serialisable metadata (`key`/`label`/`variant`/`destructive`) crosses to the client; the `handler`/`hasAccess` functions stay on the server. Clicking the button sends the `key` and selected ids back through the generic server action, which looks the handler up and runs it with a freshly-rebuilt secured context. Selection is enabled for a list that has custom actions even when Delete is denied. CSV export is documented as a recipe using this surface rather than shipping as a built-in.

- [#754](https://github.com/OpenSaasAU/stack/pull/754) [`f67cd79`](https://github.com/OpenSaasAU/stack/commit/f67cd798724712a90d7ada8f28202d3d6371693f) Thanks [@borisno2](https://github.com/borisno2)! - Add the Filter builder input UI for the admin list view ([#731](https://github.com/OpenSaasAU/stack/issues/731))

  The admin list view now ships a `FilterBuilder` that constructs the `?search=`
  filter query the filter engine already consumes (ADR-0017) — a free-text search
  box plus structured field / operator / value rows. Available fields, operators,
  and value suggestions are derived entirely from each field's self-contained
  `getFilterSpec` (via the serializable `collectFilterSuggestions` metadata), so
  there is no field-type `switch` and no functions cross the server/client
  boundary. Applied filters flow through the same secured `context.db`, so
  filtering can only ever narrow what a session may see.

  `@opensaas/stack-core` gains `serializeFilterQuery(tokens)` — the exact inverse
  of `parseFilterQuery` — so the builder produces the grammar the engine parses
  with the quoting and operator-prefix rules kept next to the parser.

  The `FilterBuilder` is composable (exported from `@opensaas/stack-ui` and
  `@opensaas/stack-ui/standalone`) with theme-token styling and `data-slot` parts
  for extension:

  ```tsx
  import { FilterBuilder } from '@opensaas/stack-ui/standalone'
  import { collectFilterSuggestions } from '@opensaas/stack-core'

  // Server component: collect serializable suggestion metadata for the list.
  const suggestions = collectFilterSuggestions(listConfig, 'Post', config)

  // Client: build and apply a `?search=` query.
  <FilterBuilder
    suggestions={suggestions}
    defaultValue={search}
    onApply={(query) => router.push(`/admin/post?search=${encodeURIComponent(query)}`)}
  />
  ```

  The list view wires this in automatically; existing `?search=` URLs keep
  working unchanged.

- [#746](https://github.com/OpenSaasAU/stack/pull/746) [`dcb10e2`](https://github.com/OpenSaasAU/stack/commit/dcb10e27c28a8a8f9a5e625f550ac5c750436eb6) Thanks [@borisno2](https://github.com/borisno2)! - Add the admin UI filter engine: a Filter spec field-builder contract and URL-driven server-side list filtering (ADR-0017).

  Fields now declare their filtering capability through a new optional `getFilterSpec` method — a peer of `getPrismaType`/`getTypeScriptType` on the field-builder contract. It reports the operators a field supports, a pure token→condition mapper, and serializable suggestion metadata. Core field types implement it (text contains + free text, integer/decimal/timestamp/calendarDay comparisons, select/checkbox equality against enumerated values, relationship by label lookup). A field without a spec — `password`, `json`, `virtual`, or any third-party field that hasn't adopted one — is simply not filterable, so the addition degrades gracefully everywhere.

  The admin list view now parses the URL filter query (the list's `search` param) through the engine and merges the result into the access-controlled query via the secured context, so filtering runs server-side and can only ever narrow — never widen — what a session may see. This replaces the previous hard-coded `type === 'text'` search; free-text behavior is now driven by each text field's Filter spec.

  Grammar (ADR-0017): implicit-AND tokens, quoted multi-word values, `>`/`>=`/`<`/`<=` comparisons on numeric/date fields, and bare words as free text. Unknown syntax degrades to free text, never errors.

  Multi-word free-text UX shift (intentional, per ADR-0017): bare words now combine with AND, so `hello world` requires each word to match separately (not the literal substring `hello world`). To match a contiguous phrase, quote it: `"hello world"`. A pasted URL such as `http://x` is treated as a single free-text token and searched verbatim — the `http:` prefix is not parsed as a field.

  New exports from `@opensaas/stack-core`:

  ```typescript
  import {
    parseFilterQuery, // (query) => FilterToken[]  — pure
    buildFilterWhere, // (tokens, specs) => where   — pure
    collectFilterSpecs, // (listConfig, listKey, config) => specs
    buildListFilterWhere, // (query, listConfig, listKey, config) => where
    collectFilterSuggestions, // serializable autocomplete metadata
  } from '@opensaas/stack-core'

  // e.g. "status:Published views:>10 author:\"Ada Lovelace\" beta"
  const where = buildListFilterWhere(query, listConfig, listKey, config)
  const rows = await context.db.post.findMany({ where }) // ANDed with the access filter
  ```

  Third-party field authors can implement `FilterSpec` (exported from `@opensaas/stack-core/extend`) to make their field filterable.

- [#760](https://github.com/OpenSaasAU/stack/pull/760) [`f8b6f02`](https://github.com/OpenSaasAU/stack/commit/f8b6f02c18322d0d04a7c3cc82e579d0ba9a2da9) Thanks [@borisno2](https://github.com/borisno2)! - Add inline cell editing to admin Relationship tables

  Cells in a to-many Relationship table on the item view are now editable in place.
  Click a cell to edit it, commit with Enter or blur, cancel with Escape. Each
  commit is a single-field update on the **related** row through the secured
  context, so the related list's own operation- and field-level update access plus
  its hooks/validation apply — never the parent's. The update is optimistic and
  reverts, with a visible reason, on a Silent failure (access denied / row gone) or
  a validation error (inline field errors surface too). Committed values re-render
  through the Cell registry, so select cells stay coloured badges.

  A field the session cannot write — or a table whose related-list update access is
  statically denied — renders read-only with no edit affordance; row-level
  (filter-scoped) denials surface at commit as a revert. Non-editable cells keep
  click-to-navigate; main list tables are unchanged (this is Relationship-table
  only).

  - `@opensaas/stack-core`: the generic server action gains a distinct
    `updateRelated` result shape (`{ updated, error?, fieldErrors? }`), and
    `checkFieldAccess` is exposed on `@opensaas/stack-core/internal` so the UI can
    decide the edit affordance without a parallel field-access evaluator.
  - `@opensaas/stack-ui`: `RelationshipTableClient` accepts `editableColumns`; the
    editable cell reuses the field-component registry for its editor and the Cell
    registry for its display (new Slots: `relationship-table-cell-display`,
    `relationship-table-cell-editor`, `relationship-table-cell-edit-trigger`,
    `relationship-table-cell-error`).

- [#757](https://github.com/OpenSaasAU/stack/pull/757) [`c05701e`](https://github.com/OpenSaasAU/stack/commit/c05701e523815b8f411a6d39e57bbb9317dc2a9d) Thanks [@borisno2](https://github.com/borisno2)! - Add a pre-linked create drawer to read-only Relationship tables (issue [#738](https://github.com/OpenSaasAU/stack/issues/738))

  The item view's read-only Relationship tables now offer a "+ Add" control that
  opens a drawer hosting the related list's create form, with the back-reference to
  the current record preset and hidden. On submit the new row is created through
  the secured context already linked to the parent, then the drawer closes and the
  table refreshes.

  Create-and-link semantics (ADR-0018): the create runs on the RELATED list, so
  the related list's own `create` access control, hooks, and field-level access
  apply — never the parent's. The back-reference is set on the server from the
  field/parent id (never trusted from the client payload). The "+ Add" is shown
  only when a back-reference exists to preset the link and the related list's
  `create` access is not statically denied; a filter/function-scoped denial
  surfaces at commit time as a generic error (no denied-vs-absent leak).

  New generic server action (`@opensaas/stack-core`):

  ```ts
  await context.serverAction({
    listKey: 'Post', // the RELATED list
    action: 'createRelated',
    data: { title: 'Hello', slug: 'hello' },
    field: 'author', // the back-reference field on Post
    parentId: user.id, // the record being edited
  })
  // → { created: true, id } | { created: false, error?, fieldErrors? }
  ```

  The drawer (`RelationshipCreateDrawer` from `@opensaas/stack-ui`) mounts on the
  existing `relationship-table-toolbar` seam and reuses the shared item-form engine
  and field-component registry, so the related list's full validation and required
  fields are enforced even when a required field is not one of the table's columns.

- [#756](https://github.com/OpenSaasAU/stack/pull/756) [`8199238`](https://github.com/OpenSaasAU/stack/commit/81992382290f356071955f16efd14f7771045a16) Thanks [@list({](https://github.com/list({)! - Add relationship-table row removal to the admin item view (ADR-0018)

  Each read-only Relationship table row now has a ✕ removal control. By default it
  **disconnects** the related row from the current record (non-destructive — the
  row survives and still appears on its own list), gated on the related list's
  update access. A per-relationship opt-in truly deletes the related row (behind a
  confirmation, gated on the related list's delete access), or hides the control
  entirely. Where the schema makes disconnect impossible (a required foreign key on
  the related side) the control is hidden unless delete is opted in. Removals run
  through the secured context, so an access-denied removal is a Silent failure: the
  row stays with a visible reason.

  Configure per relationship via `ui.itemView.removeAction`:

  ```typescript

    fields: {
      // Default: ✕ disconnects the post (it still exists).
      posts: relationship({ ref: 'Post.author', many: true }),
      // Opt in to destructive delete (confirmed).
      notes: relationship({
        ref: 'Note.owner',
        many: true,
        ui: { itemView: { removeAction: 'delete' } }, // 'disconnect' (default) | 'delete' | 'none'
      }),
    },
  })
  ```

  `@opensaas/stack-core` adds a `removeRelated` server action (distinct
  `{ removed }` result shape, like `bulkDelete`, so a redirect-on-success wrapper
  never hijacks an in-place removal) and the `RelationshipItemViewConfig.removeAction`
  option.

- [#745](https://github.com/OpenSaasAU/stack/pull/745) [`4d99e91`](https://github.com/OpenSaasAU/stack/commit/4d99e910b61c6196564a7248abf3d32b1d6be883) Thanks [@borisno2](https://github.com/borisno2)! - Add a Cell registry with default cells for core field types

  List tables now render every value through a **Cell** resolved by a
  cell-component registry that mirrors the form-field registry's priority chain:
  per-field override → custom type registry → field-type registry → plain-text
  fallback. Each core field type ships a default Cell — text (plain), integer
  (tabular figures), select (coloured Badge), timestamp (formatted date), checkbox
  (mark), and to-one relationship (Item label link). Unknown/third-party types
  without a registered Cell fall back to plain text.

  Select options gain optional, additive per-option UI metadata mapping a value to
  a badge variant. Existing options keep working unchanged; unmapped options render
  the neutral badge.

  ```typescript
  // opensaas.config.ts — colour a status value in list-table cells
  status: select({
    options: [
      { label: 'Draft', value: 'draft', ui: { variant: 'secondary' } },
      { label: 'Published', value: 'published', ui: { variant: 'success' } },
    ],
  })
  ```

  Register a Cell for a custom/third-party field exactly as you register its form
  component, or override a single field's Cell:

  ```typescript
  'use client'
  import { registerCellComponent } from '@opensaas/stack-ui'
  registerCellComponent('myField', MyCell)

  // or per-field override (highest priority)
  price: integer({ ui: { cell: CurrencyCell } })
  ```

- [#750](https://github.com/OpenSaasAU/stack/pull/750) [`047487a`](https://github.com/OpenSaasAU/stack/commit/047487adf502f10f7f6774ff52c38c70d465f533) Thanks [@borisno2](https://github.com/borisno2)! - Add row selection and a built-in Bulk action Delete to the admin list view

  The list table now renders a selection checkbox column when the list's delete
  access is not statically false. The header checkbox toggles the visible page,
  per-row checkboxes accumulate an explicit id set across pages, and the selection
  clears when the filter changes. A selection bar shows the count, a Clear action,
  a named `data-slot="selection-actions"` seam for future custom bulk actions, and
  — only when delete access allows — a Delete that confirms first, deletes each
  selected row through the secured context honouring Silent failure, and reports
  "N of M deleted" (partial access denials are visible without revealing which or
  why).

  The admin list view also honours an optional `?pageSize=` URL param, preserved
  across sorting, searching and paging.

  New exports: `RowSelectionBar` (with `RowSelectionBarProps` /
  `RowSelectionBarClassNames`) and the `useRowSelection` hook plus the pure
  `isPageFullySelected` / `getPageCheckboxState` helpers.

  ```tsx
  import { RowSelectionBar, useRowSelection } from '@opensaas/stack-ui'

  const selection = useRowSelection('Post', filterKey)
  <RowSelectionBar
    count={selection.selectedCount}
    onClear={selection.clear}
    onDelete={async () => {
      /* delete the selected ids through the secured context */
    }}
  />
  ```

- [#751](https://github.com/OpenSaasAU/stack/pull/751) [`20459b5`](https://github.com/OpenSaasAU/stack/commit/20459b5a7f8b2578342509442d36017cfa2f08f6) Thanks [@list({](https://github.com/list({)! - Derive the admin item view from the list shape, with read-only Relationship tables and a totals footer ([#734](https://github.com/OpenSaasAU/stack/issues/734))

  A record's edit page now derives its layout from the list's shape. Scalar and
  to-one fields stay in a details card (whole-form Save/Cancel, unchanged), and
  each to-many relationship renders as a read-only **Relationship table**: one
  to-many relationship gives a two-column split, none gives a single centered
  card, several stack. Table columns default to the related list's own column
  curation minus the back-reference to the parent, cells come from the cell
  registry, and a totals footer always shows the row count plus sums for any
  explicitly-configured numeric columns (each formatted by that column's Cell).
  Rows are fetched through the secured context, so only access-visible data shows.
  Rows are read-only here — a row click navigates to the related record.

  `@opensaas/stack-core` gains additive item-view config (no breaking changes):

  ```typescript
  lists: {

      fields: {
        posts: relationship({
          ref: 'Post.author',
          many: true,
          ui: {
            itemView: {
              // Override the Relationship table's columns…
              columns: ['title', 'status', 'viewCount'],
              // …and sum numeric columns in the totals footer.
              sum: ['viewCount'],
              // Or demote it back to the compact picker in the details card:
              // displayMode: 'picker',
            },
          },
        }),
      },
      // Reorder the Relationship-table sections:
      ui: { itemView: { order: ['posts'] } },
    }),
  }
  ```

  New `@opensaas/stack-ui` exports: `RelationshipTable`, `RelationshipTableClient`,
  and the pure `deriveItemViewLayout` helper (with `ItemViewLayout`,
  `ItemViewArrangement`, `RelationshipTableSection`). The Relationship table ships
  named Slots (`relationship-table`, `relationship-table-toolbar`,
  `relationship-table-row`, `relationship-table-cell`, `relationship-table-footer`)
  as extension seams for the follow-up inline-edit, create-drawer, and row-removal
  work.

- [#774](https://github.com/OpenSaasAU/stack/pull/774) [`62a1612`](https://github.com/OpenSaasAU/stack/commit/62a16127c7b6610a35fb239911eff3486de585be) Thanks [@borisno2](https://github.com/borisno2)! - Bound the admin item-view Relationship tables with a `take` and a "showing N of M" footer

  The read-only Relationship tables on a record's edit page (issue [#734](https://github.com/OpenSaasAU/stack/issues/734)) previously
  fetched every related row unbounded. They now fetch a bounded page of related rows
  and surface the full access-scoped total in the footer.

  - **Bounded fetch:** each to-many Relationship table fetches at most a default cap
    of related rows (`DEFAULT_ITEM_VIEW_TAKE`, 10), overridable per relationship via
    `ui.itemView.take`. Rows are still fetched through the secured context, so only
    access-visible rows come back.
  - **"Showing N of M" footer:** the totals footer now reads `Showing N of M rows`,
    where N is the rendered (bounded) count and M is the full access-scoped total,
    fetched via a filtered `_count` that folds the related list's own `query` access
    in (mirroring the list view's count columns). A fully-denied related list reads
    `Showing 0 of 0` and never leaks a true total. The row count is always shown,
    including the zero-column footer path.

  ```typescript
  sessions: relationship({
    ref: 'Session.user',
    many: true,
    // Cap this table at 5 rows; the footer still shows the full access-scoped total.
    ui: { itemView: { take: 5 } },
  })
  ```

  Core: `mergeIncludeWithAccessControl` now preserves a caller-supplied `take` on a
  to-many relation include (it only narrows the fetch, never widening past the access
  `where`), so the secured `findUnique`/`findMany` include can bound related-row reads.

- [#764](https://github.com/OpenSaasAU/stack/pull/764) [`c210319`](https://github.com/OpenSaasAU/stack/commit/c210319c3b25ff74d832d3c2ec5d3253d5d8b832) Thanks [@list({](https://github.com/list({)! - Admin list view: to-many relationship columns render an access-visible count, sort by relation count, and filter by numeric count comparisons (issue [#732](https://github.com/OpenSaasAU/stack/issues/732)). Virtual fields render via their Cell but are excluded from sorting and filtering.

  A to-many relationship used as a list column now shows the count of the related rows the session may see — fetched in the SAME query via a filtered Prisma `_count`, with the related list's `query` access folded into the count's `where`, so it never counts rows the session cannot read and issues no per-row query. Clicking the column header sorts by relation `_count`, and its Filter spec offers numeric comparisons on the count (`posts:>5`) in the filter builder and in shared URLs.

  Because Prisma cannot compare a relation count in a `where`, a to-many relationship's Filter spec emits a structured count marker that is resolved to an access-scoped `{ id: { in } }` before the query runs, through the secured context.

  New `@opensaas/stack-core` exports: `buildRelationshipCountSelect`, `resolveRelationshipCountFilters`, `isToManyRelationshipField`, and `RELATIONSHIP_COUNT_FILTER_KEY` (with the `RelationshipCountFilterMarker` type).

  ```ts
  // A to-many relationship column now shows an access-scoped count and is
  // sortable / filterable by that count — zero config:

    fields: {
      name: text(),
      posts: relationship({ ref: 'Post.author', many: true }),
    },
  })
  // List view: the `posts` column renders the count; its header sorts by count;
  // `posts:>5` filters by count in the builder and in a shared URL.
  ```

- [#788](https://github.com/OpenSaasAU/stack/pull/788) [`613902c`](https://github.com/OpenSaasAU/stack/commit/613902c13e092f29939618f87c6d3dfeac74a60d) Thanks [@borisno2](https://github.com/borisno2)! - Standalone `ListTable` now routes every cell through the shared cell registry (`CellRenderer`), matching `ListView`. The bespoke relationship renderer and `fieldTypes[column] === 'relationship'` branch are gone in favour of `RelationshipCell`, which already handles link navigation and `stopPropagation`.

  A new optional `fieldOptions` prop lets `select` columns resolve label mapping and `ui.variant` badge colour, exactly like `ListView`:

  ```tsx
  <ListTable
    items={posts}
    fieldTypes={{ title: 'text', status: 'select' }}
    fieldOptions={{
      status: [
        { label: 'Published', value: 'published', ui: { variant: 'success' } },
        { label: 'Draft', value: 'draft' },
      ],
    }}
    columns={['title', 'status']}
  />
  ```

  Existing `ListTable` call sites keep working unchanged.

### Patch Changes

- [#780](https://github.com/OpenSaasAU/stack/pull/780) [`55d55e0`](https://github.com/OpenSaasAU/stack/commit/55d55e0a1ed9521b6e31283524d9194a9420059a) Thanks [@borisno2](https://github.com/borisno2)! - Fix a to-one relationship filter token (e.g. `author:Ada`) leaking related-list data by ANDing the related list's `query` access filter into the nested condition instead of running it unscoped.

- [#775](https://github.com/OpenSaasAU/stack/pull/775) [`2fcb582`](https://github.com/OpenSaasAU/stack/commit/2fcb5820bc00d9d432265d1ba01404097e296e8e) Thanks [@borisno2](https://github.com/borisno2)! - Exclude json columns from relationship-table inline editing so an unchanged json cell no longer wastes a secured update round-trip

## 0.30.0

## 0.29.0

### Minor Changes

- [#723](https://github.com/OpenSaasAU/stack/pull/723) [`a7babf9`](https://github.com/OpenSaasAU/stack/commit/a7babf9c6f579c333462adf58018a594d09790c6) Thanks [@borisno2](https://github.com/borisno2)! - Admin chrome polish pass: consistent page headers, designed empty states, skeleton coverage, nav active states, and table density (issue [#710](https://github.com/OpenSaasAU/stack/issues/710)).

  The prebuilt admin now shares a restrained, token-driven chrome across every screen. Two new composable components are exported and used throughout:

  - `PageHeader` — the consistent title/description/back-link/actions pattern used by the dashboard, list, item, and singleton screens. Exposes `data-slot` parts (`page-header`, `page-header-title`, `page-header-description`, `page-header-actions`, `page-header-back`, `page-header-icon`) and a structured `classNames` contract. An opt-in `gradient` prop frames the dashboard — the design system's single signature gradient moment.
  - `EmptyState` — a designed empty surface (icon + title + description + actions) now shown on every list and relationship surface. Also exposes `data-slot` parts and a `classNames` contract.

  ```tsx
  import { PageHeader, EmptyState } from '@opensaas/stack-ui'

  <PageHeader title="Posts" description="12 items" actions={<CreateButton />} />

  <EmptyState
    icon={<Inbox />}
    title="No items yet"
    description="Create your first record to see it listed here."
    actions={<CreateButton />}
  />
  ```

  Also included:

  - Full-screen skeleton fallbacks (`DashboardSkeleton`, `ListViewSkeleton`, `ItemFormSkeleton`, `PageHeaderSkeleton`) wired through a `Suspense` boundary in `AdminUI`, so every data-loading screen streams behind a placeholder of the same shape.
  - Navigation active states now use `aria-current="page"` and a flat solid brand fill (no gradient/pulse); nav and dashboard icons use `lucide-react` instead of emoji.
  - Tables right-align numeric columns and use tabular numerals; a new `isNumericField(fieldType)` helper is exported.
  - Gradient usage is limited to the dashboard header accent and avatar fallbacks per the spec; the brand wordmark and active nav are now solid tokens.

  No new capabilities and no information-architecture changes — this is a visual/chrome polish pass consuming existing tokens.

- [#718](https://github.com/OpenSaasAU/stack/pull/718) [`713409b`](https://github.com/OpenSaasAU/stack/commit/713409b88abdb5d23ebad5e86759eea4dbdd0717) Thanks [@borisno2](https://github.com/borisno2)! - Re-curate the theme presets (`modern` / `classic` / `neon`) in the token vocabulary

  Each preset now defines every color token in both light and dark — including the
  `success`/`warning` intent colors and the gradient pair — so switching `preset`
  fully reskins the admin with no token falling through to another preset. Presets
  also carry their own shape and elevation, and the theme compiler merges them
  under any config overrides:

  - `modern` (default): the restrained, low-chroma direction with one saturated
    brand color and the gradient pair as garnish. Inherits the stylesheet's radius
    and soft shadows (kept in sync with `globals.css`).
  - `classic`: flat and enterprise-safe — blue primary, no gradient, squared-off
    radius, and elevation removed (`--shadow-*: none`).
  - `neon`: the high-chroma cyan/purple/pink personality — pink primary, purple
    accent, a cyan→pink signature gradient, and a rounder radius.

  Preset-only configs upgrade unchanged (the names are preserved):

  ```ts
  ui: {
    theme: {
      preset: 'neon'
    }
  }
  ```

- [#716](https://github.com/OpenSaasAU/stack/pull/716) [`316f976`](https://github.com/OpenSaasAU/stack/commit/316f9765336b3fc2aa2a743dcd6d33e53e01488b) Thanks [@borisno2](https://github.com/borisno2)! - Add user-controllable dark mode: `ThemeToggle` and `ThemeScript`

  The admin chrome now ships a light/dark/system color-scheme control built on the
  `light-dark()` token contract. A `data-theme` attribute on the document root pins
  `color-scheme` (overriding the OS preference); its absence follows the system.

  - `ThemeToggle` — a client component that cycles light → dark → system, writes
    `data-theme` on `<html>`, persists the choice to `localStorage`
    (`opensaas-theme`), and restores it on mount. It appears in the default Admin
    chrome's user menu and is opt-out via composition (custom chrome omits it).
  - `ThemeScript` — a server-safe inline `<script>` for the document `<head>` that
    applies the saved choice before first paint, preventing a flash of the wrong
    scheme.

  ```tsx
  import { ThemeScript } from '@opensaas/stack-ui'

  export default function RootLayout({ children }) {
    return (
      <html lang="en" suppressHydrationWarning>
        <head>
          <ThemeScript />
        </head>
        <body>{children}</body>
      </html>
    )
  }
  ```

  To pin the admin to a single scheme, omit both and set the attribute statically,
  e.g. `<html data-theme="dark">`. The `ThemeChoice` type and the
  `applyThemeChoice` / `readStoredChoice` / `themeInitScript` / `THEME_STORAGE_KEY`
  helpers are also exported for building custom controls.

- [#720](https://github.com/OpenSaasAU/stack/pull/720) [`c44b678`](https://github.com/OpenSaasAU/stack/commit/c44b678d9a3108c6e5a4d446e3966fded63687b6) Thanks [@borisno2](https://github.com/borisno2)! - Design system pass for field components and standalone composites: token-only styling, structured `classNames` slots, status tokens, and shared form rhythm.

  **Field components** now share one label / help / error rhythm via a small shell (`FieldRoot`, `FieldLabel`, `FieldHelp`, `FieldError`, `FieldWarning`, `FieldReadValue`). Every field consumes theme tokens only — the previously hardcoded status colours (a green upload check, an amber JSON warning) now use the `success` / `warning` tokens. All fields accept a consistent `helpText` prop.

  **Composites accept structured, strongly-typed `classNames` slots** merged per part via tailwind-merge, and every part carries a stable `data-slot`:

  - `ListTable` — `classNames={{ root, frame, table, header, headerRow, headerCell, body, row, cell, actionsHeader, actionsCell, empty }}`; root `data-slot="list-table"`.
  - `SearchBar` — `classNames={{ root, form, inputWrapper, input, clearButton, submit }}`; root `data-slot="search-bar"`.
  - `DeleteButton` — `classNames={{ button, error }}`; error `data-slot="delete-button-error"`.
  - `ItemCreateForm` / `ItemEditForm` — `classNames={{ root, error, fields, actions, submit, cancel }}`; roots `data-slot="item-create-form"` / `"item-edit-form"`.
  - `RelationshipManager` — `classNames={{ root, label, frame, row, cell, emptyState, actions, connectButton, error }}`; root `data-slot="relationship-manager"`.

  **New `Badge` primitive** for status rendering, with `success` / `warning` / `destructive` / `default` / `secondary` / `outline` variants driven entirely by tokens:

  ```tsx
  import { Badge } from '@opensaas/stack-ui/primitives'

  ;<Badge variant={post.status === 'published' ? 'success' : 'warning'}>{post.status}</Badge>
  ```

  Example: restyle just the rows of a table without forking it:

  ```tsx
  <ListTable
    items={posts}
    fieldTypes={{ title: 'text', status: 'select' }}
    classNames={{ frame: 'shadow-sm', headerCell: 'uppercase text-xs', row: 'hover:bg-accent/40' }}
  />
  ```

- [#725](https://github.com/OpenSaasAU/stack/pull/725) [`f51cef8`](https://github.com/OpenSaasAU/stack/commit/f51cef876d6376e4e2bc8ac990229ff60e232bb1) Thanks [@borisno2](https://github.com/borisno2)! - Wire field help text through the admin renderer via `ui.description`

  Field authors can now set help/description text on a field's `ui.description`
  and have it render beneath the control in the prebuilt admin UI. `FieldRenderer`
  surfaces `ui.description` to the rendered field component as its `helpText` prop,
  which displays through the shared field-shell `FieldHelp` (data-slot="field-help").
  Previously `helpText` only worked when a field component was composed by hand.

  ```typescript
  fields: {
    slug: text({
      ui: { description: 'URL-friendly identifier, lowercase only.' },
    }),
  }
  ```

  The option is optional and non-breaking; fields without a description render no
  help text, exactly as before.

- [#719](https://github.com/OpenSaasAU/stack/pull/719) [`c04590e`](https://github.com/OpenSaasAU/stack/commit/c04590e9b79399c29295f2001717241058f224d1) Thanks [@borisno2](https://github.com/borisno2)! - Restyle every primitive onto the design system tokens, with a stable `data-slot` contract and a tailwind-merge'd `className` on every part

  Following Button ([#705](https://github.com/OpenSaasAU/stack/issues/705)), all remaining primitives — Input, Textarea, Label,
  Checkbox, Card, Table, Dialog, Select, Popover, Calendar, TimePicker,
  DateTimePicker, and Combobox — now consume only theme tokens (no hardcoded
  colours or shadows remain; e.g. the Dialog no longer uses `bg-white` /
  `border-gray-200` / `shadow-2xl` / `bg-black/80`).

  Every primitive and composite part now carries a documented, stable `data-slot`
  attribute, and merges a caller `className` via tailwind-merge so instance
  overrides win:

  ```tsx
  // Instance override (tailwind-merge — caller wins over the default radius)
  <Card className="rounded-none" />

  // Deep restyle from plain CSS, no Tailwind pipeline required (ADR-0016)
  [data-slot='table-row']:nth-child(even) { background: rgba(0, 0, 0, 0.04); }
  ```

  The `data-slot` name set is a public compatibility promise. Full contract:
  `input`, `textarea`, `label`, `checkbox`, `checkbox-indicator`, `card`,
  `card-header`, `card-title`, `card-description`, `card-content`, `card-footer`,
  `table-container`, `table`, `table-header`, `table-body`, `table-footer`,
  `table-row`, `table-head`, `table-cell`, `table-caption`, `dialog-overlay`,
  `dialog-content`, `dialog-header`, `dialog-footer`, `dialog-title`,
  `dialog-description`, `dialog-close`, `select-trigger`, `select-content`,
  `select-viewport`, `select-label`, `select-item`, `select-separator`,
  `select-scroll-up-button`, `select-scroll-down-button`, `popover-content`,
  `calendar`, `time-picker`, `datetime-picker`, `combobox-trigger`,
  `combobox-content`, `combobox-search`, `combobox-list`, `combobox-empty`,
  `combobox-item`, `combobox-separator` (plus `button` from [#705](https://github.com/OpenSaasAU/stack/issues/705)).

- [#724](https://github.com/OpenSaasAU/stack/pull/724) [`e180821`](https://github.com/OpenSaasAU/stack/commit/e180821e7f9537eceb0d889eda098dd8304a3e53) Thanks [@borisno2](https://github.com/borisno2)! - Add optional `nonce` prop to `ThemeScript` for strict-CSP compatibility

  `ThemeScript` renders the flash-prevention code as an inline `<script>`, which a
  strict nonce-based `script-src` Content-Security-Policy blocks unless the tag
  carries a matching `nonce`. You can now forward the per-request nonce:

  ```tsx
  import { headers } from 'next/headers'
  import { ThemeScript } from '@opensaas/stack-ui'

  export default async function RootLayout({ children }) {
    const nonce = (await headers()).get('x-nonce') ?? undefined
    return (
      <html lang="en" suppressHydrationWarning>
        <head>
          <ThemeScript nonce={nonce} />
        </head>
        <body>{children}</body>
      </html>
    )
  }
  ```

  The prop is optional — omitting it is byte-identical to before (no `nonce`
  attribute emitted). When provided, the value is forwarded only to the
  `<script>`'s `nonce` attribute; it is never interpolated into the script body.

- [#713](https://github.com/OpenSaasAU/stack/pull/713) [`56e9f9b`](https://github.com/OpenSaasAU/stack/commit/56e9f9b0a4d1920662cf0564682e767993917b56) Thanks [@borisno2](https://github.com/borisno2)! - Add the theming token contract and a pure `ui.theme` compiler, proven end-to-end through Button.

  The UI package stylesheet now defines the full Theme token vocabulary as a single, un-driftable contract: the shadcn color set plus `success`/`warning` (with foregrounds) and a `gradientFrom`/`gradientTo` pair, `--font-sans`/`--font-mono`/`--font-heading` (heading defaults to sans), a single `--radius` knob with derived sm/md/lg sizes, and `--shadow-sm`/`--shadow-md`/`--shadow-lg` — all with light and dark values side by side via `light-dark()`.

  `ThemeConfig` is a clean break (ADR-0015). Colors accept any valid CSS color string and are emitted verbatim — the compiler never parses colors. Bare HSL triplets (`'220 20% 97%'`) are no longer accepted and fire a dev-mode warning suggesting an `hsl()` wrap.

  ```typescript
  ui: {
    theme: {
      preset: 'modern', // 'modern' | 'classic' | 'neon'
      colors: { primary: '#16a34a' }, // hex, oklch(...), rgb(...), hsl(...)
      darkColors: { primary: '#4ade80' },
      fonts: { sans: 'var(--font-inter), system-ui, sans-serif' }, // compose with next/font
      radius: 0.5, // rem
      shadows: { sm: 'none', md: 'none', lg: 'none' }, // flat theme
    },
  }
  ```

  The config layer compiles onto the same CSS custom properties the stylesheet declares, so the two can never drift. `Button` is restyled to consume only these tokens (color, radius, shadow, font) and carries a stable `data-slot="button"`.

  Migration: wrap any old bare-triplet color value in `hsl()` (`'220 20% 97%'` → `'hsl(220 20% 97%)'`). Preset-only configs need no changes.

### Patch Changes

- [#726](https://github.com/OpenSaasAU/stack/pull/726) [`ababdc3`](https://github.com/OpenSaasAU/stack/commit/ababdc302c1c52d8085cf827a4d015b599af9d48) Thanks [@borisno2](https://github.com/borisno2)! - Derive the stylesheet's `modern` color defaults from `presetThemes.modern` via a `generate:css` codegen step (wired into build), so the preset and `globals.css` can no longer drift. No visual or behavioral change — the emitted CSS is byte-identical to the previous values.

## 0.28.0

## 0.27.1

## 0.27.0

### Minor Changes

- [#638](https://github.com/OpenSaasAU/stack/pull/638) [`95560e4`](https://github.com/OpenSaasAU/stack/commit/95560e4db69ae390131f02c357c7c0e0b82d4304) Thanks [@borisno2](https://github.com/borisno2)! - Wire the edit page onto the relationship-options primitive so relationship dropdowns are fast and live-searchable. The item-form preparation now fetches a bounded, take-limited window via `getRelationshipOptions` instead of an unbounded `findMany({})` per relationship field, always unioning the current value's id(s) so its label renders even outside the window.

  `ComboboxField` (single) and `RelationshipManager` (many) gain debounced live search: typing narrows results against the label field via the `relationshipOptions` serverAction op, without any wiring changes required in host apps — `ItemForm`/`SingletonView` already pass `serverAction` and `listKey` through.

  ```typescript
  // No config changes needed — AdminUI's edit page picks this up automatically.
  // A field's relationship dropdown now:
  // 1. Renders a bounded initial window (default 50) with the current value's label always visible
  // 2. Debounces typed input and searches server-side via context.serverAction({ action: 'relationshipOptions', ... })
  ```

  Components without a wired `serverAction` (e.g. custom usages of `ComboboxField`/`RelationshipManager`) fall back to client-side filtering over the initial window, unchanged from previous behavior.

- [#636](https://github.com/OpenSaasAU/stack/pull/636) [`a15e566`](https://github.com/OpenSaasAU/stack/commit/a15e5660d736c8ea2d4b804c5ef6891510b2ea3d) Thanks [@borisno2](https://github.com/borisno2)! - Add a relationship-options read primitive: `getRelationshipOptions(context, config, relatedListKey, { search?, take?, selectedIds? })` returns a bounded, projected `{ id, label }[]` for relationship editors. It selects only `id` and the resolved label field (via `getLabelFieldName`), so no depth-5 auto-include ever runs; `search` filters via `contains` when the label field is text; results are ordered by the label field; and currently-selected `selectedIds` are always unioned into the result even when outside the `search`/`take` window. Operation-level `query` access on the related list still applies (denied → `[]`).

  Also adds a `relationshipOptions` op on `context.serverAction` so hosts can resolve options from a client without a bespoke endpoint:

  ```typescript
  await context.serverAction({
    listKey: 'Post',
    action: 'relationshipOptions',
    field: 'author',
    search: 'ada',
    take: 20,
    selectedIds: ['user-123'],
  })
  // => { success: true, data: [{ id: 'user-123', label: 'Ada Lovelace' }, ...] }
  ```

  `getRelationshipOptions` is exported from `@opensaas/stack-core` and re-exported from `@opensaas/stack-ui` for server components that already hold a context.

### Patch Changes

- [#639](https://github.com/OpenSaasAU/stack/pull/639) [`3b2beb7`](https://github.com/OpenSaasAU/stack/commit/3b2beb7fbe64ce34510a5f59e0403a9b2fdab52d) Thanks [@borisno2](https://github.com/borisno2)! - List-page relationship cells now render their label via the shared label seam (`getItemLabel`), honouring a related list's `ui.labelField` instead of an inline `name → title → label → id` guess that had drifted from the item form.

- [#664](https://github.com/OpenSaasAU/stack/pull/664) [`37838ef`](https://github.com/OpenSaasAU/stack/commit/37838efbf726b27baa5e1da448d44223c6953e3f) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade TypeScript to v7. `typescript` now resolves to the `@typescript/typescript6` compatibility shim (keeping the classic compiler API available for `typescript-eslint` and Next.js's build-time type-checking, neither of which support TS 7's restructured package yet), while `@typescript-eslint/eslint-plugin` is bumped to 8.63.0 to match. The CLI's Node-build compiler step (ADR-0011) now shells out to `tsc` instead of the removed synchronous `Program` API, using its own pinned native TS 7 binary via a new `@typescript/native` dependency.

## 0.26.0

## 0.25.0

### Patch Changes

- [#607](https://github.com/OpenSaasAU/stack/pull/607) [`61547be`](https://github.com/OpenSaasAU/stack/commit/61547beb5ec7d4aff30753849e36a738c49c91e4) Thanks [@borisno2](https://github.com/borisno2)! - Fix `ui.listView.initialSort` applying sort client-side instead of as a DB-level `orderBy`

  Previously, `initialSort` was applied to the already-fetched page in memory, meaning a 500-row list with `initialSort: { field: 'sentAt', direction: 'desc' }` would only show the 50 most recent rows of the _current page_ rather than the 50 most recent rows overall. The sort is now passed as `orderBy` to `findMany` so pagination and sorting compose correctly.

  Column-header clicks also now navigate with a `?sort=field:direction` URL param (instead of mutating local state), so subsequent sorts are also DB-level and work correctly across pages.

## 0.24.0

### Minor Changes

- [#552](https://github.com/OpenSaasAU/stack/pull/552) [`66496b4`](https://github.com/OpenSaasAU/stack/commit/66496b487bae61f3cdea26fcfcaf605caaaa5520) Thanks [@borisno2](https://github.com/borisno2)! - Add list-level `ui.listView` config (mirroring Keystone) for default columns and sort

  Lists now support a `ui.listView` block in `opensaas.config.ts` that sets the
  admin list table's default column selection/order and default sort. Naming
  mirrors Keystone's `ui.listView` so migrators can map defaults directly.

  ```typescript
  lists: {
    Post: list({
      fields: {
        title: text(),
        status: text(),
        createdAt: timestamp(),
      },
      ui: {
        listView: {
          // Column selection AND order
          initialColumns: ['title', 'status'],
          // Default sort
          initialSort: { field: 'createdAt', direction: 'desc' },
        },
      },
    }),
  }
  ```

  When `ui.listView` is absent, behaviour is unchanged: the table shows all
  non-system fields and applies no default sort.

## 0.23.0

### Minor Changes

- [#543](https://github.com/OpenSaasAU/stack/pull/543) [`4de6a3b`](https://github.com/OpenSaasAU/stack/commit/4de6a3b35ff2337fbd32f285e6c0cc63a0b2d2cf) Thanks [@borisno2](https://github.com/borisno2)! - Handle `autoCreate: false` singletons and access-denied reads in the AdminUI singleton editor.

  When a singleton's `get()` returns no record, `SingletonView` now disambiguates the two reasons a singleton can be empty and renders the safe affordance:
  - **`autoCreate: false` with no row yet** (query + create allowed): renders a create-on-first-save form (reuses `ItemFormClient` in `mode="create"`). Core assigns the singleton `id` and enforces the single-record constraint on save, so the form sends only the user-entered field data.
  - **`query` access denied**: renders a friendly "no access" message — never an editable or create form.
  - **create denied (autoCreate: false, no row)**: renders a friendly "no record yet" message instead of an unusable form.

  An update-denied singleton still renders the edit form, but the save fails gracefully via the server action's denied envelope. The happy path (a record exists → edit form) and non-singleton lists are unchanged.

- [#542](https://github.com/OpenSaasAU/stack/pull/542) [`ef6ce9a`](https://github.com/OpenSaasAU/stack/commit/ef6ce9a3d9c8c129626d98640004c2c0bf84b656) Thanks [@borisno2](https://github.com/borisno2)! - Render a single-record editor for `isSingleton` lists in `AdminUI`

  A list configured with `isSingleton: true` now renders a single-record editor at
  its bare `[list]` route instead of a list table. The new `SingletonView`
  component resolves the record via the singleton `get()` operation (which
  auto-creates the row with field defaults when absent) and reuses the existing
  `ItemFormClient` in edit mode, so field rendering, validation, and the existing
  `serverAction` save path all apply unchanged. Non-singleton lists are
  unaffected and still render the table.

  ```typescript
  // opensaas.config.ts
  lists: {
    SiteSettings: list({
      isSingleton: true,
      fields: {
        siteName: text(),
        supportEmail: text(),
      },
    }),
  }
  ```

  Visiting `/admin/site-settings` now shows an "Edit Site Settings" form for the
  single record rather than a one-row list.

- [#544](https://github.com/OpenSaasAU/stack/pull/544) [`581ef89`](https://github.com/OpenSaasAU/stack/commit/581ef89975e41a359b0a92c4808fbcdee7fe1607) Thanks [@borisno2](https://github.com/borisno2)! - Add first-class singleton presentation to the admin Navigation and Dashboard

  Singleton lists (`isSingleton`) are now visually distinguished from ordinary lists:
  - **Navigation:** singletons render under a dedicated "Settings" group with a gear
    icon, separate from the standard "Lists" group. Each still links to its
    single-record editor (`/<basePath>/<url>`). The "Settings" group is omitted when
    there are no singletons (and the "Lists" group is omitted when there are only
    singletons).
  - **Dashboard:** singletons appear in their own "Settings" section with a
    "Configure" affordance instead of the misleading "N items" count (a singleton's
    count is always 0 or 1). The Dashboard no longer calls `count()` for singletons.

  Non-singleton lists are unchanged.

- [#545](https://github.com/OpenSaasAU/stack/pull/545) [`f2cc754`](https://github.com/OpenSaasAU/stack/commit/f2cc754e34b07a427168ddb11cfc33d74457af82) Thanks [@borisno2](https://github.com/borisno2)! - Suppress create/delete affordances and redirect sub-routes for singleton lists in the admin UI.

  Singleton lists (`isSingleton: true`) have a single record edited at their bare `[list]` route, so the create and delete affordances no longer apply:
  - The Dashboard "Quick Actions" no longer renders a "Create {list}" link for singletons (only standard lists). The Quick Actions card is hidden entirely in a singleton-only admin.
  - The singleton editor (`SingletonView`) no longer renders a Delete control. A new optional `canDelete` prop (default `true`) on `ItemFormClient` controls this; non-singleton edit forms keep their Delete button.
  - The singleton sub-routes `/admin/<list>/create` and `/admin/<list>/<id>` now server-side `redirect()` to the bare editor `/admin/<list>`, so old links keep working.

  Non-singleton create/delete affordances and routing are unchanged.

## 0.22.0

## 0.21.0

### Minor Changes

- [#417](https://github.com/OpenSaasAU/stack/pull/417) [`ed1c9f5`](https://github.com/OpenSaasAU/stack/commit/ed1c9f532b77ef59d7a845731e6a6116904a859e) Thanks [@borisno2](https://github.com/borisno2)! - Unify the item-form logic behind a shared `useItemForm` engine

  The AdminUI form (`ItemFormClient`) and the standalone `ItemCreateForm`/
  `ItemEditForm` each carried their own near-identical copy of the form state,
  the relationship-to-`connect` submit transform, the clear-error-on-change
  behaviour, and the error/pending handling. That logic now lives once in a
  `useItemForm` hook (with pure, exported `transformItemFormData`,
  `transformInitialData`, and `getEditableFields` helpers); each form supplies
  only an `onSubmit` adapter and renders the returned state.

  Behaviour is unified to the superset: every form now applies the relationship
  transform, the password `{ isSet }` skip for unchanged passwords, and
  system-field filtering. The transform logic is covered by unit tests for the
  first time.

  No public API change — `ItemCreateForm`, `ItemEditForm`, and the AdminUI form
  keep their existing props.

- [#415](https://github.com/OpenSaasAU/stack/pull/415) [`8980ff3`](https://github.com/OpenSaasAU/stack/commit/8980ff36ffb0879d8f4409740493dd940572cc9d) Thanks [@borisno2](https://github.com/borisno2)! - Curate the `@opensaas/stack-core` public surface into clearly-scoped entry points

  The root entry point now exposes only the everyday consumer surface — `config`,
  `list`, `getContext`, the naming helpers (`getDbKey`, `getUrlKey`,
  `getListKeyFromUrl`), `ValidationError`, and the config/access types you annotate
  with. Plugin and field authoring contracts move to a new `/extend` path, and the
  plumbing shared with sibling packages and generated code moves to `/internal`.

  ```typescript
  // Everyday usage (unchanged)
  import { config, list, getContext } from '@opensaas/stack-core'

  // Authoring a plugin or a third-party field package
  import type { Plugin, BaseFieldConfig, TypeInfo } from '@opensaas/stack-core/extend'
  ```

  `@opensaas/stack-core/internal` carries no semver guarantees; application code
  should never import from it. `Session` stays on the root entry point because it is
  the module-augmentation target.

  Removed from the public surface (zero callers): the nine `*HookArgs` types and the
  callerless typed-query runtime types. The other `@opensaas/*` packages and the CLI
  generator are updated to import from the new paths.

### Patch Changes

- [#412](https://github.com/OpenSaasAU/stack/pull/412) [`9696f98`](https://github.com/OpenSaasAU/stack/commit/9696f9800284f94e21e14c31a716de4b48d736e5) Thanks [@borisno2](https://github.com/borisno2)! - Refactor `FieldRenderer` to use data-presence checks instead of `fieldConfig.type` comparisons

  `FieldRenderer` no longer checks `fieldConfig.type` to decide which props to pass to field
  components. Field-specific UI props (select options, relationship items/key/many) are now derived
  from the serialised field config using data-presence checks (`fieldConfig.options`, `fieldConfig.ref`)
  — the same self-contained pattern used for Prisma and TypeScript generation.

  **For users:** no changes required. Field rendering behaviour is unchanged.

## 0.20.1

## 0.20.0

## 0.19.1

## 0.19.0

## 0.18.2

## 0.18.1

## 0.18.0

## 0.17.0

## 0.16.0

## 0.15.0

## 0.14.0

## 0.13.0

## 0.12.1

## 0.12.0

## 0.11.0

## 0.10.0

## 0.9.0

## 0.8.0

## 0.7.0

## 0.6.2

## 0.6.1

## 0.6.0

## 0.5.0

## 0.4.0

### Minor Changes

- [#170](https://github.com/OpenSaasAU/stack/pull/170) [`3c4db9d`](https://github.com/OpenSaasAU/stack/commit/3c4db9d8318fc73d291991d8bdfa4f607c3a50ea) Thanks [@list({](https://github.com/list({)! - Add support for virtual fields with proper TypeScript type generation

  Virtual fields are computed fields that don't exist in the database but are added to query results at runtime. This feature enables derived or computed values to be included in your API responses with full type safety.

  **New Features:**
  - Added `virtual()` field type for defining computed fields in your schema
  - Virtual fields are automatically excluded from database schema and input types
  - Virtual fields appear in output types with full TypeScript autocomplete
  - Virtual fields support `resolveOutput` hooks for custom computation logic

  **Type System Improvements:**
  - Generated Context type now properly extends AccessContext from core
  - Separate Input and Output types (e.g., `UserOutput` includes virtual fields, `UserCreateInput` does not)
  - UI components now accept `AccessContext<any>` for better compatibility with custom context types
  - Type aliases provide convenience (e.g., `User = UserOutput`)

  **Example Usage:**

  ```typescript
  import { list, text, virtual } from '@opensaas/stack-core'

  export default config({
    lists: {

        fields: {
          name: text(),
          email: text(),
          displayName: virtual({
            type: 'string',
            hooks: {
              resolveOutput: async ({ item }) => {
                return `${item.name} (${item.email})`
              },
            },
          }),
        },
      }),
    },
  })
  ```

  The `displayName` field will automatically appear in query results with full TypeScript support, but won't be part of create/update operations or the database schema.

### Patch Changes

- [#172](https://github.com/OpenSaasAU/stack/pull/172) [`929a2a9`](https://github.com/OpenSaasAU/stack/commit/929a2a9a2dfa80b1d973d259dd87828d644ea58d) Thanks [@list<Lists.User.TypeInfo>({](https://github.com/list<Lists.User.TypeInfo>({), [@list<Lists.User.TypeInfo>({](https://github.com/list<Lists.User.TypeInfo>({)! - Improve TypeScript type inference for field configs and list-level hooks by automatically passing TypeInfo from list level down

  This change eliminates the need to manually specify type parameters on field builders when using features like virtual fields, and fixes a critical bug where list-level hooks weren't receiving properly typed parameters.

  ## Field Type Inference Improvements

  Previously, users had to write `virtual<Lists.User.TypeInfo>({...})` to get proper type inference. Now TypeScript automatically infers the correct types from the list-level type parameter.

  **Example:**

  ```typescript
  // Before

    fields: {
      displayName: virtual<Lists.User.TypeInfo>({
        type: 'string',
        hooks: {
          resolveOutput: ({ item }) => `${item.name} (${item.email})`,
        },
      }),
    },
  })

  // After

    fields: {
      displayName: virtual({
        type: 'string',
        hooks: {
          resolveOutput: ({ item }) => `${item.name} (${item.email})`,
        },
      }),
    },
  })
  ```

  ## List-Level Hooks Type Inference Fix

  Fixed a critical type parameter mismatch where `Hooks<TTypeInfo>` was passing the entire TypeInfo object as the first parameter instead of properly destructuring it into three required parameters:
  1. `TOutput` - The item type (what's stored in DB)
  2. `TCreateInput` - Prisma create input type
  3. `TUpdateInput` - Prisma update input type

  **Impact:**
  - `resolveInput` now receives proper Prisma input types (e.g., `PostCreateInput`, `PostUpdateInput`)
  - `validateInput` has access to properly typed input data
  - `beforeOperation` and `afterOperation` have correct item types
  - All list-level hook callbacks now get full IntelliSense and type checking

  **Example:**

  ```typescript
  Post: list<Lists.Post.TypeInfo>({
    fields: { title: text(), content: text() },
    hooks: {
      resolveInput: async ({ operation, resolvedData }) => {
        // ✅ resolvedData is now properly typed as PostCreateInput or PostUpdateInput
        // ✅ Full autocomplete for title, content, etc.
        if (operation === 'create') {
          console.log(resolvedData.title) // TypeScript knows this is string | undefined
        }
        return resolvedData
      },
      beforeOperation: async ({ operation, item }) => {
        // ✅ item is now properly typed as Post with all fields
        if (operation === 'update' && item) {
          console.log(item.title) // TypeScript knows this is string
          console.log(item.createdAt) // TypeScript knows this is Date
        }
      },
    },
  })
  ```

  ## Breaking Changes
  - Field types now accept full `TTypeInfo extends TypeInfo` instead of just `TItem`
  - `FieldsWithItemType` utility replaced with `FieldsWithTypeInfo`
  - All field builders updated to use new type signature
  - List-level hooks now receive properly typed parameters (may reveal existing type errors)

  ## Benefits
  - ✨ Cleaner code without manual type parameter repetition
  - 🎯 Better type inference in both field-level and list-level hooks
  - 🔄 Consistent type flow from list configuration down to individual fields
  - 🛡️ Maintained full type safety with improved DX
  - 💡 Full IntelliSense support in all hook callbacks

## 0.3.0

## 0.2.0

## 0.1.7

### Patch Changes

- Updated dependencies [372d467]
  - @opensaas/stack-core@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [39996ca]
- Updated dependencies [39996ca]
  - @opensaas/stack-core@0.1.6

## 0.1.5

### Patch Changes

- 17eaafb: Update package urls
- Updated dependencies [17eaafb]
  - @opensaas/stack-core@0.1.5

## 0.1.4

### Patch Changes

- Updated dependencies [d013859]
  - @opensaas/stack-core@0.1.4

## 0.1.3

### Patch Changes

- efe2357: fix getting started package imports
  - @opensaas/stack-core@0.1.3

## 0.1.2

### Patch Changes

- @opensaas/stack-core@0.1.2

## 0.1.1

### Patch Changes

- 9a3fda5: Add JSON field
- 045c071: Add field and image upload
- Updated dependencies [9a3fda5]
- Updated dependencies [f8ebc0e]
- Updated dependencies [045c071]
  - @opensaas/stack-core@0.1.1
