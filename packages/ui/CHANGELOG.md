# @opensaas/stack-ui

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
