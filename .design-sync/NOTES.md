# design-sync NOTES — @opensaas/stack-ui

Repo-specific gotchas for future syncs. Read this before re-syncing.

## Build & shape

- **Shape: package** (no Storybook). Bundle entry: `packages/ui/dist/index.js`. Run the converter
  from the **repo root** with `--entry ./packages/ui/dist/index.js --node-modules packages/ui/node_modules`.
  That entry makes PKG_DIR resolve to `packages/ui`, so all `cfg.*` package-relative paths work.
- **Build first**: `pnpm install` then `cfg.buildCmd` (`pnpm -F "@opensaas/stack-ui..." build`). The
  package self-installs nothing in its own node_modules for `@opensaas/stack-ui`, hence `--entry`.
- react/react-dom/@types/react resolve in `packages/ui/node_modules` (react 19.2.4).

## CRITICAL: the main entry only re-exports Badge from primitives

`dist/index.js` exports the composites/fields/standalone + **only Badge** from primitives. Button,
Card, Input, Select, Dialog, Table, Checkbox, Textarea, Label, Popover, Calendar, Combobox,
TimePicker, DateTimePicker live under the `./primitives` subpath. To get them into the bundle
(`window.StackUI.*`) AND discovered as components:
- `cfg.extraEntries: ["./dist/primitives/index.js"]` merges all primitives onto the global (the
  converter's `__dsMainNs` footer makes main's Badge win the one collision — the `[EXPORT_COLLISION]
  Badge` warning is EXPECTED and harmless).
- `cfg.componentSrcMap` pins each primitive to its `src/primitives/*.tsx` for discovery + `.d.ts`.
- Authored previews import primitives from the **bare** `'@opensaas/stack-ui'` (not `/primitives`) —
  the story-import shim maps the bare package to the global, which has everything. Importing from
  `/primitives` or a relative path bundles a broken duplicate.

## CRITICAL: Next.js stubs (why the bundle doesn't crash)

Many components import `next/link`, `next/navigation`, `next/image`. Next's module-scope
`process.env.*` reads crash a bare browser and blanked the ENTIRE bundle at load. Fix (config-native,
no lib fork): `cfg.tsconfig: "../../.design-sync/next-stub-tsconfig.json"` maps those specifiers
(note the `.js` suffixes: `next/link.js` etc.) to browser-safe stubs in `.design-sync/stubs/next/`.
- These stubs (link→`<a>`, navigation→noop router, image→`<img>`) are committed durable inputs.
- `next/headers` is only a JSDoc comment (ThemeScript) — not imported, no stub needed.
- If a future component adds a new `next/*` import, add a stub + a paths entry (with the exact
  specifier suffix the dist uses) or the bundle blanks again.
- Beware: the tsconfig-paths plugin JSON parser strips `//` naively — do NOT put a `"//"` comment
  key in `next-stub-tsconfig.json` (it corrupts the JSON and silently disables the paths plugin).

## Overlays & dialogs need cardMode:single

Radix overlays (Select, Dialog, Popover, Combobox) + ConfirmDialog portal their open content to
`<body>`. `cfg.overrides.<Name>: {cardMode:"single", viewport:"WxH"}` makes the whole page the card
so the open state captures. Authored with `defaultOpen` (Radix Root) / `isOpen` (ConfirmDialog).

## Process gotcha: set overrides BEFORE authoring/scoped-rebuild

Adding `cfg.overrides` (or titleMap) AFTER a full build makes `preview-rebuild --components` abort
with `[CONFIG_STALE]` (per-component cfgSlice stamp is stale). Only `package-build.mjs` re-stamps.
So: set all overlay/override config first, run one full `package-build`, THEN fan out scoped
subagents. (This bit the overlay wave once; fixed by a full rebuild.)

## Components that stay FLOOR CARDS (by design)

- **Dashboard, ListView, ItemForm, SingletonView** (and AdminUI/Navigation render only shells):
  require a live `AccessContext` (Prisma) + full `OpenSaasConfig`; several are async/data-fetching
  server components. They CANNOT render statically. Their value to the design agent is the accurate
  `.d.ts` + `.prompt.md` contract, not a preview. Do not try to mock a full context.
- **ThemeScript**: injects a `<script>` (no visual output) — floor card is correct.

## Per-component authoring notes (for re-authoring/updates)

- Fields follow the controlled shape (name/value/onChange/label/error/disabled/required/mode/helpText).
  SelectField `options: {label,value}[]`. RelationshipField uses `items: {id,label}[]` + `value:
  string|string[]`, `many` toggles combobox vs connected table; omit `relatedListKey`/`basePath` to
  avoid the `next/link` row path in static capture. PasswordField `value: string | {isSet}`; the
  visible input is internal-state driven (passed string doesn't prefill). CheckboxField has no
  `required`/`placeholder`. TimestampField `value: string|Date` (date-fns). IntegerField `value:
  number` (required).
- FieldRenderer config is `SerializableFieldConfig` — plain JSON `{type,label?,validation?,options?,
  ui?}`; dispatches by `type` through the registry.
- Field* shell primitives only render as visual leaves — always compose inside a `FieldRoot` + `Input`.
- Badge variants: default/secondary/success/warning/destructive/outline.

## Known render warns

- `[EXPORT_COLLISION] Badge` on every build — EXPECTED (see extraEntries note above). Not a failure.
- No `[FONT_MISSING]` — the DS uses system font stacks (Tailwind v4 `@theme` `--font-*`), nothing to ship.
- No `bad` components after authoring; DateTimePicker/TimePicker/PasswordField "closed trigger / empty
  form" renders are intentional (interaction-only interiors aren't statically renderable).

## Styling idiom

Tailwind CSS v4. Tokens live in `dist/styles/globals.css` (`@theme` block) → `cfg.cssEntry`, and are
reachable to designs via `styles.css` → `_ds_bundle.css`. `light-dark()` tokens; default render is
light. Contract tokens: `--color-{background,foreground,card,primary,secondary,muted,accent,
destructive,success,warning,border,input,ring,...}`, `--radius`, `--font-sans/heading/mono`.

## Presentational & standalone authoring notes

- **SkeletonLoader** only reads `{className, variant}` — it does NOT spread `style`/rest props, and
  its `circular`/`rectangular` variants carry no intrinsic size. Size them with **className utilities
  that already exist in `packages/ui/src`** (Tailwind only compiles classes seen in component source,
  not in previews): e.g. `h-12 w-12` (circular), `h-16 w-64` (rectangular), `w-48`/`w-32` (text).
  `grep -rhoE '\bh-(full|[0-9]+)\b' packages/ui/src | sort -u` shows what's compiled.
- **ConfirmDialog** `variant` only changes the confirm-button color (`danger`→red, `warning`→blue) on
  identical chrome — use distinct copy per cell. Already has a `cardMode:single` override; author with `isOpen`.
- **ItemCreateForm/ItemEditForm** accept `fields: Record<string,FieldConfig>` but internally run
  `serializeFieldConfigs`, which reads only `{type,label?,validation?,options?,many?,ref?,ui?}` — so
  previews pass **plain serializable objects**, no field-builder methods. ItemEditForm `initialData`
  is values keyed by field name (timestamp = ISO string, select = an option `value`).
- **ListTable**: `items` + `fieldTypes` (use plain `'text'`/`'integer'`, NOT `'relationship'` which
  emits `next/link` row paths) + `columns`; `items=[]` + `emptyMessage` renders the empty state.
- **DeleteButton** / **SearchBar** / **UserMenu** / **ThemeToggle**: pure prop-driven client
  components, no override needed (DeleteButton's confirm dialog is click-only so the static card shows
  the trigger). `onSubmit`/`onDelete` → `async () => ({success:true})`; `onSignOut` → `async () => {}`.

## Re-sync risks (what can silently go stale)

- **Next stubs**: if the package upgrades Next or adds a new `next/*` import path, the stub tsconfig
  `paths` must be updated (match the exact specifier suffix in `dist/`), else the bundle blanks. Re-check
  `grep -rhoE "from ['\"]next/[a-z.]+" packages/ui/dist` after any dep bump.
- **Primitive set**: if `src/primitives/*` gains/loses a component, update `cfg.componentSrcMap`.
- **Composite floor cards**: Dashboard/ListView/ItemForm/SingletonView are tied to upstream context
  APIs; their `.d.ts`/`.prompt.md` update automatically but they stay floor cards.
- Authored previews are static compositions of the real components; a breaking prop-rename upstream
  would surface as a failed preview compile on the next build — re-check the affected `previews/*.tsx`.
