# Plain-CSS theming via `data-slot` (no Tailwind pipeline)

This example demonstrates the third rung of the admin UI customization ladder
(`specs/THEMING.md`, ADR-0016): **restyling primitives from plain CSS by
targeting stable `data-slot` selectors, in an app that consumes only the
package's precompiled stylesheet and runs no Tailwind pipeline of its own.**

Every exported primitive and composite part in `@opensaas/stack-ui/primitives`
carries a documented, stable `data-slot` attribute (`data-slot="button"`,
`data-slot="table-row"`, `data-slot="dialog-content"`, …). Those names are a
public compatibility promise, so a stylesheet that targets them keeps working
across releases — no forking, no Tailwind, no build step.

## Files

- **`index.html`** — the exact markup the `@opensaas/stack-ui` primitives emit
  (same `data-slot` attributes and token utility classes). It links two
  stylesheets and nothing else:
  1. `@opensaas/stack-ui/styles` — the package's **precompiled** CSS
     (`packages/ui/dist/styles/globals.css`).
  2. `theme-overrides.css` — our restyle.
- **`theme-overrides.css`** — hand-written plain CSS. Each rule targets a
  `[data-slot=…]` selector to flatten cards, pill the primary button,
  zebra-stripe table rows, and square the inputs — without touching any
  component source.

## Run it

```bash
# Build the ui package once so the precompiled stylesheet exists.
pnpm --filter @opensaas/stack-ui build

# Then open the file directly — no dev server, no bundler, no Tailwind.
open examples/plain-css-theming/index.html   # macOS
# or: xdg-open examples/plain-css-theming/index.html
```

You will see the overrides applied on top of the package's default look. There
is no JavaScript, no Tailwind config, and no `@source` scan involved — only the
precompiled package CSS and a plain stylesheet targeting `data-slot` selectors.

## Automated proof

The same promise is enforced as a test:
`packages/ui/tests/browser/primitives/data-slot.browser.test.tsx` renders the
real primitives, injects a plain `<style>` rule targeting `[data-slot="input"]`
and `[data-slot="table-row"]`, and asserts via `getComputedStyle` that the plain
CSS wins. If a `data-slot` name ever changes, that suite fails.
