---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Add the theming token contract and a pure `ui.theme` compiler, proven end-to-end through Button.

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
