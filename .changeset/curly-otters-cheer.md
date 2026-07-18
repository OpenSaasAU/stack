---
'@opensaas/stack-ui': minor
---

Re-curate the theme presets (`modern` / `classic` / `neon`) in the token vocabulary

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
