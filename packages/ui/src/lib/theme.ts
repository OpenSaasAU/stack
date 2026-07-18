import type { ThemeColors, ThemeConfig, ThemePreset } from '@opensaas/stack-core/internal'

/**
 * Preset theme catalogs. Each preset supplies a full light + dark color set.
 *
 * `modern` is the default and MUST stay in sync with the raw `--color-*-light`
 * / `--color-*-dark` values declared in `styles/globals.css`, so a preset-only
 * (or default) config produces the same visuals the stylesheet already ships.
 *
 * Values are any valid CSS color string (ADR-0015) — the compiler never parses
 * them, it emits them verbatim.
 */
export const presetThemes: Record<ThemePreset, { light: ThemeColors; dark: ThemeColors }> = {
  modern: {
    light: {
      background: 'oklch(0.99 0.002 264)',
      foreground: 'oklch(0.21 0.02 264)',
      card: 'oklch(1 0 0)',
      cardForeground: 'oklch(0.21 0.02 264)',
      popover: 'oklch(1 0 0)',
      popoverForeground: 'oklch(0.21 0.02 264)',
      primary: 'oklch(0.55 0.2 264)',
      primaryForeground: 'oklch(0.99 0.003 264)',
      secondary: 'oklch(0.96 0.005 264)',
      secondaryForeground: 'oklch(0.24 0.02 264)',
      muted: 'oklch(0.96 0.005 264)',
      mutedForeground: 'oklch(0.52 0.015 264)',
      accent: 'oklch(0.96 0.01 300)',
      accentForeground: 'oklch(0.24 0.02 264)',
      destructive: 'oklch(0.58 0.22 27)',
      destructiveForeground: 'oklch(0.99 0.003 264)',
      success: 'oklch(0.62 0.17 150)',
      successForeground: 'oklch(0.99 0.003 150)',
      warning: 'oklch(0.75 0.16 75)',
      warningForeground: 'oklch(0.27 0.05 75)',
      border: 'oklch(0.92 0.006 264)',
      input: 'oklch(0.92 0.006 264)',
      ring: 'oklch(0.55 0.2 264)',
      gradientFrom: 'oklch(0.55 0.2 264)',
      gradientTo: 'oklch(0.62 0.19 320)',
    },
    dark: {
      background: 'oklch(0.17 0.015 264)',
      foreground: 'oklch(0.96 0.005 264)',
      card: 'oklch(0.21 0.018 264)',
      cardForeground: 'oklch(0.96 0.005 264)',
      popover: 'oklch(0.21 0.018 264)',
      popoverForeground: 'oklch(0.96 0.005 264)',
      primary: 'oklch(0.62 0.19 264)',
      primaryForeground: 'oklch(0.15 0.02 264)',
      secondary: 'oklch(0.27 0.02 264)',
      secondaryForeground: 'oklch(0.96 0.005 264)',
      muted: 'oklch(0.27 0.02 264)',
      mutedForeground: 'oklch(0.68 0.015 264)',
      accent: 'oklch(0.3 0.03 300)',
      accentForeground: 'oklch(0.96 0.005 264)',
      destructive: 'oklch(0.62 0.21 27)',
      destructiveForeground: 'oklch(0.98 0.003 264)',
      success: 'oklch(0.68 0.16 150)',
      successForeground: 'oklch(0.15 0.02 150)',
      warning: 'oklch(0.78 0.15 75)',
      warningForeground: 'oklch(0.2 0.04 75)',
      border: 'oklch(0.3 0.02 264)',
      input: 'oklch(0.3 0.02 264)',
      ring: 'oklch(0.62 0.19 264)',
      gradientFrom: 'oklch(0.62 0.19 264)',
      gradientTo: 'oklch(0.68 0.18 320)',
    },
  },
  classic: {
    light: {
      background: 'hsl(0 0% 100%)',
      foreground: 'hsl(222 47% 11%)',
      card: 'hsl(0 0% 100%)',
      cardForeground: 'hsl(222 47% 11%)',
      popover: 'hsl(0 0% 100%)',
      popoverForeground: 'hsl(222 47% 11%)',
      primary: 'hsl(221 83% 53%)',
      primaryForeground: 'hsl(210 40% 98%)',
      secondary: 'hsl(210 40% 96%)',
      secondaryForeground: 'hsl(222 47% 11%)',
      muted: 'hsl(210 40% 96%)',
      mutedForeground: 'hsl(215 16% 47%)',
      accent: 'hsl(210 40% 96%)',
      accentForeground: 'hsl(222 47% 11%)',
      destructive: 'hsl(0 84% 60%)',
      destructiveForeground: 'hsl(210 40% 98%)',
      success: 'hsl(142 71% 45%)',
      successForeground: 'hsl(0 0% 100%)',
      warning: 'hsl(38 92% 50%)',
      warningForeground: 'hsl(0 0% 100%)',
      border: 'hsl(214 32% 91%)',
      input: 'hsl(214 32% 91%)',
      ring: 'hsl(221 83% 53%)',
      gradientFrom: 'hsl(221 83% 53%)',
      gradientTo: 'hsl(221 83% 53%)',
    },
    dark: {
      background: 'hsl(222 47% 11%)',
      foreground: 'hsl(210 40% 98%)',
      card: 'hsl(222 47% 14%)',
      cardForeground: 'hsl(210 40% 98%)',
      popover: 'hsl(222 47% 14%)',
      popoverForeground: 'hsl(210 40% 98%)',
      primary: 'hsl(217 91% 60%)',
      primaryForeground: 'hsl(222 47% 11%)',
      secondary: 'hsl(217 33% 18%)',
      secondaryForeground: 'hsl(210 40% 98%)',
      muted: 'hsl(217 33% 18%)',
      mutedForeground: 'hsl(215 20% 65%)',
      accent: 'hsl(217 33% 18%)',
      accentForeground: 'hsl(210 40% 98%)',
      destructive: 'hsl(0 63% 50%)',
      destructiveForeground: 'hsl(210 40% 98%)',
      success: 'hsl(142 71% 45%)',
      successForeground: 'hsl(0 0% 100%)',
      warning: 'hsl(38 92% 50%)',
      warningForeground: 'hsl(222 47% 11%)',
      border: 'hsl(217 33% 22%)',
      input: 'hsl(217 33% 22%)',
      ring: 'hsl(217 91% 60%)',
      gradientFrom: 'hsl(217 91% 60%)',
      gradientTo: 'hsl(217 91% 60%)',
    },
  },
  neon: {
    light: {
      background: 'hsl(0 0% 100%)',
      foreground: 'hsl(240 10% 5%)',
      card: 'hsl(0 0% 100%)',
      cardForeground: 'hsl(240 10% 5%)',
      popover: 'hsl(0 0% 100%)',
      popoverForeground: 'hsl(240 10% 5%)',
      primary: 'hsl(330 100% 50%)',
      primaryForeground: 'hsl(0 0% 100%)',
      secondary: 'hsl(240 5% 96%)',
      secondaryForeground: 'hsl(240 10% 5%)',
      muted: 'hsl(240 5% 96%)',
      mutedForeground: 'hsl(240 5% 45%)',
      accent: 'hsl(155 100% 50%)',
      accentForeground: 'hsl(240 10% 5%)',
      destructive: 'hsl(0 100% 50%)',
      destructiveForeground: 'hsl(0 0% 100%)',
      success: 'hsl(155 100% 45%)',
      successForeground: 'hsl(0 0% 100%)',
      warning: 'hsl(45 100% 50%)',
      warningForeground: 'hsl(240 10% 5%)',
      border: 'hsl(240 6% 90%)',
      input: 'hsl(240 6% 90%)',
      ring: 'hsl(330 100% 50%)',
      gradientFrom: 'hsl(330 100% 50%)',
      gradientTo: 'hsl(155 100% 50%)',
    },
    dark: {
      background: 'hsl(240 10% 5%)',
      foreground: 'hsl(0 0% 98%)',
      card: 'hsl(240 10% 8%)',
      cardForeground: 'hsl(0 0% 98%)',
      popover: 'hsl(240 10% 8%)',
      popoverForeground: 'hsl(0 0% 98%)',
      primary: 'hsl(330 100% 60%)',
      primaryForeground: 'hsl(240 10% 5%)',
      secondary: 'hsl(240 5% 15%)',
      secondaryForeground: 'hsl(0 0% 98%)',
      muted: 'hsl(240 5% 15%)',
      mutedForeground: 'hsl(240 5% 60%)',
      accent: 'hsl(155 100% 60%)',
      accentForeground: 'hsl(240 10% 5%)',
      destructive: 'hsl(0 100% 60%)',
      destructiveForeground: 'hsl(0 0% 100%)',
      success: 'hsl(155 100% 55%)',
      successForeground: 'hsl(240 10% 5%)',
      warning: 'hsl(45 100% 60%)',
      warningForeground: 'hsl(240 10% 5%)',
      border: 'hsl(240 5% 20%)',
      input: 'hsl(240 5% 20%)',
      ring: 'hsl(330 100% 60%)',
      gradientFrom: 'hsl(330 100% 60%)',
      gradientTo: 'hsl(155 100% 60%)',
    },
  },
}

/**
 * A bare HSL triplet like `220 20% 97%` (the old shadcn value format). No longer
 * a valid theme value — it must be wrapped in `hsl(...)` or replaced with any
 * other CSS color string (ADR-0015).
 */
const BARE_HSL_TRIPLET = /^[\d.]+\s+[\d.]+%\s+[\d.]+%$/

function isProduction(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
}

/**
 * Dev-mode guard for the clean break on the color value format. Fires a
 * `console.warn` when a color override is a bare HSL triplet, telling the
 * developer to wrap it in `hsl(...)`. Silent in production.
 */
function warnOnBareTriplet(tokenKey: string, value: string): void {
  if (isProduction()) return
  if (BARE_HSL_TRIPLET.test(value.trim())) {
    console.warn(
      `[stack-ui] Theme color "${tokenKey}" is set to a bare HSL triplet ("${value}"), ` +
        `which is no longer a valid theme value. Wrap it in hsl(): "hsl(${value})" ` +
        `(or use any CSS color string, e.g. oklch(...)/#hex). See specs/THEMING.md.`,
    )
  }
}

/** camelCase token key → kebab-case CSS variable segment. */
function toKebabCase(key: string): string {
  return key.replace(/([A-Z])/g, '-$1').toLowerCase()
}

/**
 * Compile a {@link ThemeConfig} to a CSS `:root { … }` string of token overrides.
 *
 * Pure function — no side effects beyond the dev-mode bare-triplet `console.warn`.
 * The emitted overrides land on the SAME custom properties the package
 * stylesheet declares (`--color-*-light` / `--color-*-dark` for colors, and the
 * `--font-*` / `--radius` / `--shadow-*` contract tokens), so config theming and
 * the stylesheet can never drift (ADR-0015).
 *
 * - Colors: preset (default `modern`) merged with `colors` (light) and
 *   `darkColors` (dark), emitted verbatim.
 * - Fonts / radius / shadows: emitted only when provided (the stylesheet ships
 *   the defaults).
 */
export function compileTheme(theme: ThemeConfig): string {
  const preset = theme.preset ?? 'modern'
  const base = presetThemes[preset]
  const light: ThemeColors = { ...base.light, ...theme.colors }
  const dark: ThemeColors = { ...base.dark, ...theme.darkColors }

  // Warn only on developer-supplied overrides — preset values are always valid.
  for (const [key, value] of Object.entries(theme.colors ?? {})) {
    if (typeof value === 'string') warnOnBareTriplet(key, value)
  }
  for (const [key, value] of Object.entries(theme.darkColors ?? {})) {
    if (typeof value === 'string') warnOnBareTriplet(key, value)
  }

  const lines: string[] = []

  for (const [key, value] of Object.entries(light)) {
    if (typeof value === 'string') lines.push(`  --color-${toKebabCase(key)}-light: ${value};`)
  }
  for (const [key, value] of Object.entries(dark)) {
    if (typeof value === 'string') lines.push(`  --color-${toKebabCase(key)}-dark: ${value};`)
  }

  if (theme.fonts?.sans) lines.push(`  --font-sans: ${theme.fonts.sans};`)
  if (theme.fonts?.mono) lines.push(`  --font-mono: ${theme.fonts.mono};`)
  if (theme.fonts?.heading) lines.push(`  --font-heading: ${theme.fonts.heading};`)

  if (theme.radius !== undefined) lines.push(`  --radius: ${theme.radius}rem;`)

  if (theme.shadows?.sm) lines.push(`  --shadow-sm: ${theme.shadows.sm};`)
  if (theme.shadows?.md) lines.push(`  --shadow-md: ${theme.shadows.md};`)
  if (theme.shadows?.lg) lines.push(`  --shadow-lg: ${theme.shadows.lg};`)

  return `:root {\n${lines.join('\n')}\n}`
}
