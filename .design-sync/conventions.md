# Building with OpenSaas Stack UI

A composable React admin-UI library (Tailwind CSS v4 + Radix primitives). Every component here is
the real shipped component — import it from `@opensaas/stack-ui` and compose with realistic props.

## Setup — no provider needed for styling

Components carry their own token-based classes, so they render on-brand as soon as the design system's
stylesheet is loaded (it already is, in this environment). There is **no ThemeProvider to wrap** — just
render the components. Dark mode is driven by `data-theme="dark"` on a root element (tokens use CSS
`light-dark()`); default is light. (The admin *composites* — `AdminUI`, `Dashboard`, `ListView`,
`ItemForm`, `SingletonView` — are the exception: they need a live server `context` + `config` and are
data-fetching, so build screens from the primitives/fields/standalone components, not these.)

## Styling idiom — Tailwind v4 utilities backed by design tokens

Style your own layout/glue with **Tailwind utility classes that resolve to the theme tokens** — never
hardcode hex colors, radii, or shadows. Use these token-backed families (real names from the compiled
stylesheet):

| Purpose | Utilities (use the token, not a raw value) |
|---|---|
| Surfaces | `bg-background` `bg-card` `bg-popover` `bg-muted` `bg-primary` `bg-secondary` `bg-accent` `bg-destructive` `bg-success` `bg-warning` |
| Text | `text-foreground` `text-muted-foreground` `text-card-foreground` `text-primary` `text-primary-foreground` `text-destructive` `text-secondary-foreground` `text-accent-foreground` |
| Borders | `border` `border-border` `border-input` `border-primary` `border-destructive` (+ `border-dashed`) |
| Radius | `rounded-sm` `rounded-md` `rounded-lg` `rounded-xl` `rounded-full` |
| Elevation | `shadow-sm` `shadow-md` `shadow-lg` `shadow-2xl` |
| Type | `font-sans` (body) `font-heading` (titles) `font-mono`; weights `font-medium` `font-semibold` `font-bold` |

Each token has a paired `-foreground` for accessible text (e.g. `bg-primary text-primary-foreground`,
`bg-destructive text-destructive-foreground`). Semantic status colors: `success`, `warning`,
`destructive` (used by `Badge` variants and field error/warning text). A signature gradient
(`gradient-from`/`gradient-to`, via `bg-gradient-to-br`) is reserved for dashboard headers
(`PageHeader gradient`).

## Where the truth lives

- **Tokens & stylesheet**: `_ds/<folder>/styles.css` and its `@import` closure (the `@theme` block
  defines every `--color-*`, `--radius-*`, `--font-*`). Read it before inventing any class.
- **Per-component API**: each component's `.d.ts` (`<Name>Props`) is the exact contract; its
  `.prompt.md` shows usage. Prefer named props over ad-hoc styling — e.g. `Button` has
  `variant="default|secondary|destructive|outline|ghost|link"` and `size="sm|default|lg|icon"`;
  fields (`TextField`, `SelectField`, …) are controlled (`value`/`onChange`) with `label`, `error`,
  `disabled`, `required`, `mode="edit|read"`, `helpText`.

## Idiomatic example

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Badge } from '@opensaas/stack-ui'

export function InvoiceCard() {
  return (
    <Card className="max-w-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Invoice #1042</CardTitle>
          <Badge variant="success">Paid</Badge>
        </div>
        <CardDescription>Billed to Ada Lovelace · Mar 2026</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between">
        <span className="text-2xl font-heading font-semibold">$1,240.00</span>
        <Button variant="outline" size="sm">Download</Button>
      </CardContent>
    </Card>
  )
}
```

The library component (`Card`, `Button`, `Badge`) carries the design language; your `className` glue
uses only token-backed utilities (`flex`, `text-2xl`, `font-heading`, `max-w-sm`).
