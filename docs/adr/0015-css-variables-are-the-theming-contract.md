# CSS variables are the theming contract; config compiles to them

The admin UI had two parallel theming mechanisms that drifted apart: `ui.theme` in `opensaas.config.ts` emitted bare HSL triplets (the shadcn v3 convention) while the package stylesheet consumed tokens directly as oklch/`light-dark()` values — so every configured theme injected invalid CSS. We decided the token set defined in the UI package stylesheet (CSS custom properties for colours, fonts, radius, shadows) is the **single** theming contract; `ui.theme` survives only as a thin compiler that writes those variables verbatim (accepting any valid CSS color string), never as a parallel system, so the two layers cannot drift again.

## Considered Options

- **CSS-only** (delete `ThemeConfig`): simplest, but abandons the stack's config-first ergonomics for the common "brand colours + font" case.
- **Config-only**: fonts and component design cannot be expressed in serializable config, so a second mechanism would be needed anyway.
- **`.dark` class convention** for dark mode: maximum shadcn familiarity, but duplicates every token definition. We instead keep `light-dark()` with a `data-theme` attribute on the root element setting `color-scheme`, which supports light/dark/system modes from a single token definition.

## Consequences

- Clean break on the `ui.theme` value format: bare HSL triplets (`'220 20% 97%'`) are no longer accepted; any valid CSS color string is. Blast radius is ~zero because the old pipeline was already emitting broken CSS for every user. A dev-mode warning detects bare triplets and suggests wrapping in `hsl()`.
- Preset names (`modern`/`classic`/`neon`) are kept but their token values re-curated, so preset-only configs upgrade with no changes.
- Developers can bypass config entirely and override tokens in their own stylesheet; both layers land on the same variables.
