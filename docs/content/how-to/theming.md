# Theming the Admin UI

The admin UI is fully themeable through a single, un-driftable contract: every
visual decision — colours, fonts, radius, shadows — flows through named **Theme
tokens** (CSS custom properties) defined once in the `@opensaas/stack-ui`
stylesheet. You override those tokens from two places that write to the _same_
variables, so they can never drift apart:

1. **Config-first** — `ui.theme` in `opensaas.config.ts`. A thin compiler emits
   token overrides. Ergonomic for the common "brand colours + font" case.
2. **CSS-first** — override the tokens in any stylesheet loaded after
   `@opensaas/stack-ui/styles`. Works with zero app-side Tailwind setup.

This guide covers the token vocabulary, `ThemeConfig`, dark mode, and the
component customization ladder. For a visual tour of the built-in starting
points, see the [Theme Presets gallery](/docs/how-to/theme-presets).

{% callout type="info" %}
The token names, the `data-slot` names, and the `ThemeConfig` shape are the
**stable public contract**. Everything else (how tokens are wired internally,
the raw `--color-*-light` / `--color-*-dark` split) is an implementation detail
that may change. Design decisions are recorded in
[ADR-0015](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0015-css-variables-are-the-theming-contract.md)
and
[ADR-0016](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0016-component-customization-restyle-or-compose-never-swap.md).
{% /callout %}

## How config and stylesheet share one token set

The UI package stylesheet (`@opensaas/stack-ui/styles`) declares the token set
once. Components never hardcode a colour or radius — they consume tokens through
Tailwind utilities (`bg-primary`, `rounded-md`, `shadow-sm`, `font-sans`, …).

When you set `ui.theme` in your config, `AdminUI` compiles it with
`compileTheme` and injects the result as a `<style>` block of token overrides.
Those overrides land on the **exact same** CSS variables the stylesheet defines,
so the config layer and the stylesheet are physically incapable of diverging.

```
opensaas.config.ts (ui.theme)
        │  compileTheme(theme)
        ▼
  :root { --color-primary-light: …; --radius: …; }   ← injected by AdminUI
        │                                                 same variables
        ▼
@opensaas/stack-ui/styles  ── --color-primary: light-dark(…) ──▶  bg-primary, ring, …
        ▲
your own stylesheet (CSS-first escape hatch) overrides the same variables
```

Values pass through **verbatim** — the compiler never parses or reasons about
colour. Whatever valid CSS string you write is what lands in the variable.

## Token vocabulary

Every token below is a compatibility promise. This is the full set.

### Colours

Each surface/intent token has a matching `*Foreground` for text/icons rendered
on top of it.

| Group         | Tokens                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------ |
| **Surfaces**  | `background`, `card`, `popover` (+ `*Foreground`)                                                |
| **Intent**    | `primary`, `secondary`, `accent`, `muted`, `destructive`, `success`, `warning` (+ `*Foreground`) |
| **Structure** | `border`, `input`, `ring`                                                                        |
| **Signature** | `gradientFrom`, `gradientTo`                                                                     |

`success` and `warning` are first-class tokens: status rendering (published /
draft / error badges, toasts) consumes them instead of hardcoded colours, so
your brand's status palette flows through automatically.

The gradient pair is used as garnish only — a few signature moments (dashboard
header accent, avatar fallbacks, active glows), never on every button.

### Typography

Family tokens only. Sizes and weights stay on Tailwind's scale.

- `--font-sans` — the base UI font (defaults to the system font stack).
- `--font-mono` — monospace (code, IDs).
- `--font-heading` — headings; defaults to `var(--font-sans)`.

These are designed to compose with [`next/font`](https://nextjs.org/docs/app/api-reference/components/font):
set the token to the font's generated CSS variable. The stack ships no webfont.

### Shape

- `--radius` — the single radius knob (in `rem` via config, or a CSS length via
  CSS). Derived `--radius-sm/md/lg/xl` sizes are computed from it, so one value
  reshapes the whole admin.

### Elevation

- `--shadow-sm`, `--shadow-md`, `--shadow-lg` — box-shadow strings. A flat theme
  sets them to `none` instead of forking components.

{% callout type="info" %}
**Deliberately excluded:** spacing / density tokens and a font-size scale.
Density theming would force every component to consume spacing variables
everywhere; the customization ladder below covers those cases. This may be
revisited on concrete demand.
{% /callout %}

## Config-first: `ui.theme`

`ThemeConfig` mirrors the token vocabulary exactly:

```typescript
// opensaas.config.ts
import { config } from '@opensaas/stack-core'

export default config({
  // ...db, lists...
  ui: {
    theme: {
      preset: 'modern', // 'modern' | 'classic' | 'neon' — defaults to 'modern'
      colors: {
        // Any token from the vocabulary, any valid CSS color string.
        primary: 'oklch(0.55 0.2 264)',
        ring: 'oklch(0.55 0.2 264)',
      },
      darkColors: {
        // Same keys, dark-mode values.
        primary: 'oklch(0.62 0.19 264)',
      },
      fonts: {
        sans: 'var(--font-inter), system-ui, sans-serif',
        mono: 'var(--font-geist-mono), ui-monospace, monospace',
        // heading defaults to sans when omitted
      },
      radius: 0.5, // rem
      shadows: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        md: '0 2px 6px -1px rgb(0 0 0 / 0.1)',
        lg: '0 8px 24px -4px rgb(0 0 0 / 0.15)',
      },
    },
  },
})
```

Every field is optional. `preset` chooses the starting point; `colors` /
`darkColors` / `fonts` / `radius` / `shadows` override individual tokens on top
of it. Setting just `{ preset: 'classic' }` gives you a complete, coherent look
with no other work.

### Values are emitted verbatim — any CSS colour

The compiler is a pure `ThemeConfig → CSS` function that **never parses colour**.
Every value is written straight through to its token, so you can paste any valid
CSS string directly from your design tool:

```typescript
colors: {
  primary: 'oklch(0.55 0.2 264)',      // oklch
  accent: '#7c3aed',                    // hex
  success: 'hsl(150 60% 45%)',          // hsl()
  warning: 'rgb(234 179 8)',            // rgb()
}
```

### Migration: bare HSL triplets are a clean break

Earlier versions expected the shadcn v3 bare-triplet format (`'220 20% 97%'`).
That format is **no longer accepted** — the value now goes into the variable
verbatim, and a bare triplet is not a valid CSS colour. In development,
`compileTheme` detects the pattern and warns:

```
[stack-ui] Theme color "primary" is set to a bare HSL triplet ("220 20% 97%"),
which is no longer a valid theme value. Wrap it in hsl(): "hsl(220 20% 97%)"
(or use any CSS color string, e.g. oklch(...)/#hex). See specs/THEMING.md.
```

To migrate, wrap old triplets in `hsl()` — or switch to any other CSS format:

```typescript
// Before (no longer valid)
colors: {
  primary: '220 83% 53%'
}

// After
colors: {
  primary: 'hsl(220 83% 53%)'
}
```

{% callout type="warning" %}
**Preset-only configs need no changes.** If your config only sets
`{ preset: '…' }` and no raw colour values, the upgrade is purely a fix — the
re-curated preset values load automatically. The clean break is safe because the
previous pipeline emitted invalid CSS for _every_ `ui.theme` user, so no working
configuration exists to break.
{% /callout %}

## CSS-first: override tokens from your own stylesheet

You never have to touch config to theme the admin. Because both layers write to
the same variables, you can override any token in a stylesheet loaded **after**
the package styles — no Tailwind pipeline required:

```typescript
// app/layout.tsx
import '@opensaas/stack-ui/styles'
import './admin-theme.css' // loaded after → wins
```

```css
/* app/admin-theme.css */
:root {
  /* Contract tokens accept any CSS colour/length, applied to both schemes. */
  --color-primary: #6d28d9;
  --color-ring: #6d28d9;
  --radius: 0.375rem;
  --shadow-sm: none;
  --shadow-md: none;
  --shadow-lg: none;
  --font-sans: 'Inter', system-ui, sans-serif;
}
```

Use config-first for the convenience of serializable, agent-writable theming;
use CSS-first when you want to theme without touching config or when your values
come from an existing design-system stylesheet.

## Fonts with `next/font`

Load your fonts with `next/font` (which handles self-hosting and
`font-display`), expose them as CSS variables, and point the font tokens at
those variables.

```tsx
// app/layout.tsx
import { Inter, Geist_Mono } from 'next/font/google'
import '@opensaas/stack-ui/styles'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
```

Then wire the tokens (config-first shown; the CSS-first equivalent sets
`--font-sans` / `--font-mono` directly):

```typescript
// opensaas.config.ts
ui: {
  theme: {
    fonts: {
      sans: 'var(--font-inter), system-ui, sans-serif',
      mono: 'var(--font-geist-mono), ui-monospace, monospace',
    },
  },
}
```

## Dark mode

Every colour token is defined once with CSS
[`light-dark()`](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark),
so light and dark values live side by side — there is no duplicated `.dark`
block. Which side renders is driven by `color-scheme`, controlled by a
`data-theme` attribute on `<html>`:

- `data-theme="light"` → forces light
- `data-theme="dark"` → forces dark
- attribute absent → follows the operating-system preference

That is the entire mechanism (about six lines of CSS).

### The `ThemeToggle` component

A `ThemeToggle` client component ships in the default admin chrome's user menu.
It cycles **light → dark → system**, writes `data-theme` on `<html>`, persists
the choice to `localStorage` (key `opensaas-theme`), and restores it on mount.

It is composable: custom chrome that builds its own navigation simply omits it,
or you can place the exported `ThemeToggle` anywhere.

```tsx
import { ThemeToggle } from '@opensaas/stack-ui'

export function MyHeader() {
  return (
    <header>
      {/* ...your chrome... */}
      <ThemeToggle />
    </header>
  )
}
```

### Avoiding a flash of the wrong scheme

Because the toggle's choice lives in `localStorage`, it isn't known during
server rendering. Add `ThemeScript` — a server-safe inline `<script>` — to your
document `<head>` so the saved choice is applied **before first paint**:

```tsx
// app/layout.tsx
import { ThemeScript } from '@opensaas/stack-ui'
import '@opensaas/stack-ui/styles'

export default function RootLayout({ children }: { children: React.ReactNode }) {
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

`suppressHydrationWarning` is required because the script mutates `data-theme`
before React hydrates.

### Pinning the admin to a single scheme

To lock the admin to light-only or dark-only (matching a product with a fixed
appearance), **omit `ThemeToggle` and `ThemeScript`** and set the attribute
statically:

```tsx
// Dark-only admin — no toggle, no localStorage.
<html lang="en" data-theme="dark">
  <body>{children}</body>
</html>
```

Because `data-theme` overrides the OS preference, the admin renders in that
scheme regardless of the visitor's system setting.

{% callout type="info" %}
Lower-level helpers are exported for building a custom toggle:
`applyThemeChoice`, `readStoredChoice`, `themeInitScript`, `THEME_STORAGE_KEY`,
and the `ThemeChoice` type.
{% /callout %}

## The component customization ladder

Theming tokens restyle everything consistently. When you need to change a
specific component's design, climb this ladder — reach for the lowest rung that
solves your problem (per
[ADR-0016](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0016-component-customization-restyle-or-compose-never-swap.md)).

### Rung 1 — Theme tokens

Restyle everything at once. This is the main body of this guide: set colours,
fonts, radius, and shadows and every component follows. Use this for brand and
global look-and-feel.

### Rung 2 — `className` / `classNames` slot props

Every exported component accepts `className`, merged onto its root via
[`tailwind-merge`](https://github.com/dcastil/tailwind-merge) so your classes
win. Composite components additionally expose a structured `classNames` object
so you can target internal parts without forking:

```tsx
import { ListTable } from '@opensaas/stack-ui/standalone'

;<ListTable
  listKey="Post"
  context={context}
  className="my-8"
  classNames={{
    frame: 'border-2',
    headerRow: 'bg-muted',
    row: 'hover:bg-accent',
    cell: 'py-3',
  }}
/>
```

Use this to tweak one instance without affecting the rest.

{% callout type="warning" %}
**Caveat:** by default your app consumes only the package's _precompiled_ CSS,
which contains only the utility classes the components themselves use. Arbitrary
utility classes you pass (like `py-3` above, if the package doesn't already use
it) only exist in the final CSS if your app runs its own Tailwind entry that
scans the package. See [Running your own Tailwind entry](#running-your-own-tailwind-entry-optional)
below. If you are not running Tailwind, use rung 3 (plain CSS) instead.
{% /callout %}

### Rung 3 — Stable `data-slot` selectors (plain CSS)

Every primitive and composite part carries a stable `data-slot` attribute
(`data-slot="button"`, `data-slot="table-row"`, `data-slot="dialog-content"`,
…). These names are a **public compatibility promise**, so plain CSS targeting
them keeps working across releases — with no Tailwind pipeline and no build
step, even in an app that consumes only the precompiled package stylesheet.

```css
/* app/admin-theme.css — loaded after @opensaas/stack-ui/styles */
[data-slot='card'] {
  border-radius: 0;
  border-width: 2px;
  box-shadow: none;
}

[data-slot='button'] {
  border-radius: 9999px;
}

[data-slot='table-row']:nth-child(even) {
  background-color: rgb(0 0 0 / 0.04);
}
```

The full list of slot names is in the [`data-slot` reference](#data-slot-name-reference)
below.

### Rung 4 — Composition and the field registry

When you need genuinely different structure, build the page yourself from the
same exported components the prebuilt admin uses — `@opensaas/stack-ui/standalone`,
`@opensaas/stack-ui/fields`, and `@opensaas/stack-ui/primitives`. See the
[Composability guide](/docs/how-to/composability).

To replace a single field's editor, use the existing field-component registry
(`registerFieldComponent`, `ui.component`, `ui.fieldType`) — see
[Custom Fields](/docs/how-to/custom-fields). Custom widgets slot into forms
without forking them.

### Not supported: swapping primitives inside `AdminUI`

There is **no** global primitive registry — you cannot swap the `Button`
implementation everywhere inside the prebuilt `AdminUI`. Per ADR-0016 this was
explicitly rejected: swapping component _behaviour_ globally is a support
liability and forces weaker types at every internal use site. The supported
answers are "restyle it" (rungs 1–3) or "compose your own pages" (rung 4).

## Running your own Tailwind entry (optional)

Rung 2's arbitrary utility classes require the classes to actually exist in your
final CSS. By default they don't — your app ships the package's precompiled
stylesheet, which only includes the utilities the components use. To make
arbitrary utilities work, run your own Tailwind entry that scans the package
source with [`@source`](https://tailwindcss.com/docs/detecting-classes-in-source-files#explicitly-registering-sources):

```css
/* app/globals.css — your Tailwind entry, imported instead of the package CSS */
@import 'tailwindcss';
@import '@opensaas/stack-ui/styles';

/* Scan the ui package so utilities it doesn't already use get generated. */
@source '../node_modules/@opensaas/stack-ui/dist';
```

Adjust the `@source` path to your `node_modules` layout (monorepos may hoist it
elsewhere). This is strictly opt-in — most apps never need it, and rung 3
(plain-CSS `data-slot` restyling) covers deep restyling with no Tailwind at all.

## `data-slot` name reference

These names are the stable, plain-CSS-targetable contract. Composite
`classNames` slots map onto these same attributes.

**Primitives**

| Component | Slots                                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button    | `button`                                                                                                                                                         |
| Badge     | `badge`                                                                                                                                                          |
| Input     | `input`                                                                                                                                                          |
| Textarea  | `textarea`                                                                                                                                                       |
| Label     | `label`                                                                                                                                                          |
| Checkbox  | `checkbox`, `checkbox-indicator`                                                                                                                                 |
| Card      | `card`, `card-header`, `card-title`, `card-description`, `card-content`, `card-footer`                                                                           |
| Table     | `table`, `table-container`, `table-header`, `table-body`, `table-footer`, `table-row`, `table-head`, `table-cell`, `table-caption`                               |
| Dialog    | `dialog-overlay`, `dialog-content`, `dialog-header`, `dialog-title`, `dialog-description`, `dialog-footer`, `dialog-close`                                       |
| Popover   | `popover-content`                                                                                                                                                |
| Select    | `select-trigger`, `select-content`, `select-viewport`, `select-item`, `select-label`, `select-separator`, `select-scroll-up-button`, `select-scroll-down-button` |
| Combobox  | `combobox-trigger`, `combobox-content`, `combobox-search`, `combobox-list`, `combobox-item`, `combobox-empty`, `combobox-separator`                              |
| Calendar  | `calendar`                                                                                                                                                       |
| Date/Time | `datetime-picker`, `time-picker`                                                                                                                                 |

**Fields**

| Part         | Slots                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| Field shell  | `field`, `field-label`, `field-required`, `field-value`, `field-help`, `field-error`, `field-warning`              |
| Relationship | `relationship-manager`, `relationship-manager-frame`, `relationship-manager-actions`, `relationship-manager-empty` |

**Standalone & chrome**

| Component      | Slots                                                                |
| -------------- | -------------------------------------------------------------------- |
| ItemCreateForm | `item-create-form`, `form-fields`, `form-actions`, `form-error`      |
| ItemEditForm   | `item-edit-form`, `form-fields`, `form-actions`, `form-error`        |
| ListTable      | `list-table`, `list-table-frame`, `list-table-empty` (+ table slots) |
| SearchBar      | `search-bar`, `search-bar-form`, `search-bar-clear`                  |
| DeleteButton   | `delete-button-error`                                                |
| ThemeToggle    | `theme-toggle`                                                       |

## See also

- [Theme Presets gallery](/docs/how-to/theme-presets) — `modern` / `classic` / `neon` in light and dark
- [Composability guide](/docs/how-to/composability) — building pages from the same components
- [Custom Fields](/docs/how-to/custom-fields) — the field-component registry
- [UI package reference](/docs/reference/ui) — full component and export list
