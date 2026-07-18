# Admin UI Design System

Specification for the admin UI design system: the theming contract, token vocabulary, component customization mechanisms, visual direction, and the scope of the restyle that applies them.

Decisions recorded in [ADR-0015](../docs/adr/0015-css-variables-are-the-theming-contract.md) (theming contract) and [ADR-0016](../docs/adr/0016-component-customization-restyle-or-compose-never-swap.md) (customization ladder). Glossary terms (Theme token, Theme preset, Slot, Admin chrome) live in the root `CONTEXT.md`.

> **Status:** This spec replaces the previous THEMING.md, which documented a pipeline that emitted bare HSL triplets into variables consumed as direct CSS colors — i.e. every configured theme produced invalid CSS. The value-format change below is therefore a clean break with ~zero blast radius.

## Goals

1. **Themeable** — a developer overrides colours, fonts, and component design without forking the package.
2. **Composable** — a developer or coding agent builds full custom forms/pages from the same components the prebuilt admin uses.
3. **Un-driftable** — one token definition; every customization layer writes to it, none parallel to it.

## Foundation

Evolve the existing package in place: shadcn/ui-style primitives, Tailwind v4, and the four export levels (`AdminUI` → `/standalone` → `/fields` → `/primitives`) are retained. No ground-up rebuild, no new primitive library.

## Theming contract

**CSS custom properties are the single contract.** The token set is defined once in the package stylesheet (`@theme` block). Two layers write to it:

1. **CSS-first (escape hatch, always available):** override tokens in any stylesheet loaded after `@opensaas/stack-ui/styles`. Works with zero app-side Tailwind setup.
2. **Config-first (convenience):** `ui.theme` in `opensaas.config.ts` compiles to token overrides injected by `AdminUI`. It is a thin compiler — values pass through verbatim, it never parses or owns color science.

### Token vocabulary

Every token is a compatibility promise. The full set:

**Colors** (each with a `*Foreground` pair where applicable):

- Surfaces: `background`, `card`, `popover` (+ foregrounds)
- Intent: `primary`, `secondary`, `accent`, `muted`, `destructive`, **`success`**, **`warning`** (+ foregrounds) — `success`/`warning` are new; status rendering (published/draft/error badges, toasts) must consume them instead of hardcoded colors
- Structure: `border`, `input`, `ring`
- Signature: `gradientFrom`, `gradientTo`

**Typography:** `--font-sans`, `--font-mono`, `--font-heading` (defaults to `var(--font-sans)`). Family tokens only — sizes/weights stay on Tailwind's scale. Designed to compose with `next/font`: the app sets the variable from `font.variable`; the stack ships no webfont and defaults to the system stack.

**Shape:** `--radius` as the single knob; derived sm/md/lg radii computed from it.

**Elevation:** `--shadow-sm`, `--shadow-md`, `--shadow-lg`. A flat theme sets them to `none` instead of forking components.

**Deliberately excluded:** spacing/density tokens and a font-size scale. Density theming would force every component to consume spacing variables everywhere; component-level customization covers it. Revisit only on concrete demand.

### `ThemeConfig` (config layer)

Mirrors the vocabulary exactly:

```typescript
ui: {
  theme: {
    preset?: 'modern' | 'classic' | 'neon',
    colors?: { primary?: string, /* any token, any valid CSS color string */ },
    darkColors?: { /* same keys, dark values */ },
    fonts?: { sans?: string, mono?: string, heading?: string },
    radius?: number,          // rem
    shadows?: { sm?: string, md?: string, lg?: string },
  }
}
```

- **Value format — clean break:** any valid CSS color string (`oklch(…)`, `#hex`, `hsl(…)`). Bare HSL triplets (`'220 20% 97%'`) are no longer accepted; a dev-mode warning detects the pattern `/^[\d.]+\s+[\d.]+%\s+[\d.]+%$/` and suggests wrapping in `hsl()`.
- Preset names survive; their token values are re-curated (see Visual direction). A preset-only config upgrades unchanged.

## Dark mode

- Tokens keep the single-definition `light-dark()` structure — light and dark values live side by side; no duplicated `.dark` block.
- A `data-theme="light" | "dark"` attribute on `<html>` sets `color-scheme`, overriding the system preference. Attribute absent = system. This is the full mechanism (~6 lines of CSS).
- A small `ThemeToggle` client component (persists choice to `localStorage`, three states: light/dark/system) ships in the default Admin chrome's user menu, removable via composition.
- Developers pin a scheme by setting the attribute statically.

## Component customization ladder

Per ADR-0016, in increasing power:

1. **Tokens** — restyle everything consistently (this spec's main body).
2. **`className` / `classNames` slot props** on every exported component, merged via `tailwind-merge`. Composites take structured slots, e.g. `<ListTable classNames={{ row, header, cell }}>`. _Caveat:_ arbitrary utility classes require the app to run its own Tailwind entry (`@import 'tailwindcss'` + `@source` pointing at the ui package) — documented as the opt-in "customizing" setup, since apps by default consume only the package's precompiled CSS.
3. **Stable `data-slot` attributes** on every primitive and composite part (`data-slot="button"`, `data-slot="table-row"`, …). Plain-CSS restyling with no Tailwind pipeline; the attribute names are a stable public contract.
4. **Composition** — build pages from `/standalone`, `/fields`, `/primitives`; replace field widgets via the existing field-component registry (`registerFieldComponent`, `ui.component`, `ui.fieldType`).

**Explicitly rejected:** a global primitive registry (swap `Button` everywhere inside `AdminUI`). The supported answers are "restyle it" or "compose your own pages."

## Visual direction

Default = **restrained, Linear-class**. Personality is opt-in via preset.

- Near-white/near-black surfaces with very low chroma tint; hierarchy from subtle borders and shadow tokens, not color blocking.
- One saturated brand color used sparingly: primary actions, focus rings, active nav.
- Gradient pair as garnish only — a few signature moments (dashboard header accent, avatar fallbacks, active glows), never on every button.
- System font stack by default; tightened hierarchy — clear weights, slightly smaller base in dense areas, tabular numerals in tables.
- Softer radius, crisper borders, quieter muted text than the current styles.

**Presets (re-curated):**

| Preset    | Character                                                       |
| --------- | --------------------------------------------------------------- |
| `modern`  | The restrained direction above (default)                        |
| `classic` | Flat, no gradients, blue primary, enterprise-safe               |
| `neon`    | The current high-chroma cyan/purple/pink personality, preserved |

## Scope of the restyle

**Tier: re-skin + chrome polish. No new capabilities.**

In scope:

- Every primitive and component restyled to the new tokens/direction, consuming `--font-*`, shadow tokens, `success`/`warning`, and carrying `data-slot` attributes + `classNames` props.
- Chrome polish on existing screens: consistent page headers, designed empty states, skeleton coverage, nav active states, table density/alignment (tabular numerals, right-aligned numbers), form section rhythm, `ThemeToggle` in the user menu.

Out of scope (future specs, on this foundation): command palette, saved views, new navigation paradigms, density theming, type-scale tokens.

## Migration notes

- `ui.theme` color values: wrap old triplets in `hsl()` — `'220 20% 97%'` → `'hsl(220 20% 97%)'` — or move to any other CSS color format.
- Preset-only configs: no change required; the upgrade is strictly a fix.
- The old `generateThemeCSS` HSL output and the `--color-*-light/-dark` split in `globals.css` are internal details that may change; only the token names above are contract.

## Suggested implementation sequence

Slices that land independently:

1. **Token pipeline rebuild** — new vocabulary in `globals.css`, fixed `ThemeConfig` compiler + dev warning, `data-theme` mechanism, re-curated presets.
2. **Primitives pass** — restyle + `data-slot` + `className` merge on every primitive.
3. **Fields & standalone pass** — `classNames` slots on composites, status colors, form rhythm.
4. **Chrome pass** — navigation, page headers, empty/skeleton states, `ThemeToggle`, dashboard.
5. **Docs** — theming guide rewrite, "customizing" Tailwind setup guide, preset gallery.
