import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { compileTheme, presetThemes } from '../../src/lib/theme.js'
import type { ThemeColors, ThemePreset } from '@opensaas/stack-core/internal'

// The full color token vocabulary every preset must define, in both light and
// dark, per the theming contract (specs/THEMING.md). Kept as an explicit list
// so a preset that drops a token — or the stylesheet gaining a new one — fails a
// test rather than silently falling through to another preset's value.
const COLOR_TOKENS: (keyof ThemeColors)[] = [
  'background',
  'foreground',
  'card',
  'cardForeground',
  'popover',
  'popoverForeground',
  'primary',
  'primaryForeground',
  'secondary',
  'secondaryForeground',
  'muted',
  'mutedForeground',
  'accent',
  'accentForeground',
  'destructive',
  'destructiveForeground',
  'success',
  'successForeground',
  'warning',
  'warningForeground',
  'border',
  'input',
  'ring',
  'gradientFrom',
  'gradientTo',
]

const PRESET_NAMES: ThemePreset[] = ['modern', 'classic', 'neon']

// The compiler is a pure `ThemeConfig -> CSS string` function. These tests
// assert external behaviour only: the exact token overrides the CSS contains,
// which token groups are emitted, verbatim value pass-through, and the
// dev-mode bare-HSL-triplet warning. They never inspect internal structure.

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('compileTheme', () => {
  it('wraps output in a :root block', () => {
    const css = compileTheme({})
    expect(css.startsWith(':root {')).toBe(true)
    expect(css.trimEnd().endsWith('}')).toBe(true)
  })

  describe('preset selection', () => {
    it('defaults to the modern preset when no preset is given', () => {
      const css = compileTheme({})
      expect(css).toContain(`--color-primary-light: ${presetThemes.modern.light.primary};`)
      expect(css).toContain(`--color-primary-dark: ${presetThemes.modern.dark.primary};`)
    })

    it('emits the classic preset when selected', () => {
      const css = compileTheme({ preset: 'classic' })
      expect(css).toContain('--color-primary-light: hsl(221 83% 53%);')
      expect(css).toContain('--color-background-light: hsl(0 0% 100%);')
    })

    it('emits the neon preset when selected', () => {
      const css = compileTheme({ preset: 'neon' })
      expect(css).toContain('--color-primary-light: hsl(330 100% 50%);')
      expect(css).toContain('--color-primary-dark: hsl(330 100% 60%);')
    })
  })

  describe('light/dark override merge', () => {
    it('overrides only the specified tokens, keeping the preset for the rest', () => {
      const css = compileTheme({
        preset: 'classic',
        colors: { primary: 'oklch(0.6 0.2 20)' },
        darkColors: { primary: '#123456' },
      })
      // Overridden token uses the supplied light and dark values
      expect(css).toContain('--color-primary-light: oklch(0.6 0.2 20);')
      expect(css).toContain('--color-primary-dark: #123456;')
      // Untouched tokens fall back to the classic preset
      expect(css).toContain('--color-background-light: hsl(0 0% 100%);')
    })

    it('emits light and dark values side by side for every color token', () => {
      const css = compileTheme({})
      for (const token of ['primary', 'background', 'success', 'warning', 'gradient-from']) {
        expect(css).toContain(`--color-${token}-light:`)
        expect(css).toContain(`--color-${token}-dark:`)
      }
    })
  })

  describe('token groups', () => {
    it('emits success and warning color tokens (with foregrounds)', () => {
      const css = compileTheme({})
      expect(css).toContain('--color-success-light:')
      expect(css).toContain('--color-success-foreground-light:')
      expect(css).toContain('--color-warning-light:')
      expect(css).toContain('--color-warning-foreground-light:')
    })

    it('emits the gradient pair', () => {
      const css = compileTheme({})
      expect(css).toContain('--color-gradient-from-light:')
      expect(css).toContain('--color-gradient-to-dark:')
    })

    it('emits font tokens only when provided', () => {
      expect(compileTheme({})).not.toContain('--font-')
      const css = compileTheme({
        fonts: {
          sans: 'var(--font-inter), system-ui, sans-serif',
          mono: 'ui-monospace, monospace',
          heading: 'Georgia, serif',
        },
      })
      expect(css).toContain('--font-sans: var(--font-inter), system-ui, sans-serif;')
      expect(css).toContain('--font-mono: ui-monospace, monospace;')
      expect(css).toContain('--font-heading: Georgia, serif;')
    })

    it('emits radius only when provided, in rem', () => {
      expect(compileTheme({})).not.toContain('--radius:')
      expect(compileTheme({ radius: 0.5 })).toContain('--radius: 0.5rem;')
    })

    it('emits shadow tokens only when provided, including a flat none theme', () => {
      expect(compileTheme({})).not.toContain('--shadow-')
      const css = compileTheme({ shadows: { sm: 'none', md: 'none', lg: 'none' } })
      expect(css).toContain('--shadow-sm: none;')
      expect(css).toContain('--shadow-md: none;')
      expect(css).toContain('--shadow-lg: none;')
    })

    it('emits only the shadow sizes that are supplied', () => {
      const css = compileTheme({ shadows: { md: '0 4px 8px black' } })
      expect(css).toContain('--shadow-md: 0 4px 8px black;')
      expect(css).not.toContain('--shadow-sm:')
      expect(css).not.toContain('--shadow-lg:')
    })
  })

  describe('verbatim value pass-through', () => {
    it('emits any valid CSS color string exactly as given, without parsing', () => {
      const css = compileTheme({
        colors: {
          primary: 'rgb(1 2 3 / 50%)',
          accent: '#abcdef',
          background: 'color-mix(in oklch, red, blue)',
        },
      })
      expect(css).toContain('--color-primary-light: rgb(1 2 3 / 50%);')
      expect(css).toContain('--color-accent-light: #abcdef;')
      expect(css).toContain('--color-background-light: color-mix(in oklch, red, blue);')
    })
  })

  describe('bare-HSL-triplet dev warning', () => {
    it('warns and suggests hsl() wrapping for a bare triplet in light colors', () => {
      vi.stubEnv('NODE_ENV', 'development')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      compileTheme({ colors: { primary: '222 47% 11%' } })
      expect(warn).toHaveBeenCalledTimes(1)
      const message = warn.mock.calls[0]?.[0]
      expect(message).toContain('primary')
      expect(message).toContain('hsl(222 47% 11%)')
    })

    it('warns for bare triplets supplied in darkColors', () => {
      vi.stubEnv('NODE_ENV', 'development')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      compileTheme({ darkColors: { background: '220 20% 97%' } })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toContain('hsl(220 20% 97%)')
    })

    it('does not warn for valid CSS color strings', () => {
      vi.stubEnv('NODE_ENV', 'development')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      compileTheme({
        colors: { primary: 'hsl(222 47% 11%)', accent: 'oklch(0.6 0.2 20)', ring: '#fff' },
      })
      expect(warn).not.toHaveBeenCalled()
    })

    it('does not warn for a preset-only config', () => {
      vi.stubEnv('NODE_ENV', 'development')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      compileTheme({ preset: 'neon' })
      expect(warn).not.toHaveBeenCalled()
    })

    it('is silent in production even for a bare triplet', () => {
      vi.stubEnv('NODE_ENV', 'production')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      compileTheme({ colors: { primary: '222 47% 11%' } })
      expect(warn).not.toHaveBeenCalled()
    })
  })
})

describe('preset catalog completeness', () => {
  // The acceptance-criteria guard for issue #707: every preset must define every
  // color token in both light and dark, so switching preset never leaves a token
  // falling through to another preset's value.
  for (const preset of PRESET_NAMES) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${preset} defines every color token in ${mode}`, () => {
        const colors = presetThemes[preset][mode]
        for (const token of COLOR_TOKENS) {
          expect(colors[token], `${preset}.${mode}.${token}`).toBeTypeOf('string')
        }
      })

      it(`${preset} defines no unknown color tokens in ${mode}`, () => {
        const keys = Object.keys(presetThemes[preset][mode]).sort()
        expect(keys).toEqual([...COLOR_TOKENS].sort())
      })
    }

    it(`${preset} compiles both light and dark values for every token`, () => {
      const css = compileTheme({ preset })
      for (const token of COLOR_TOKENS) {
        const cssVar = `--color-${token.replace(/([A-Z])/g, '-$1').toLowerCase()}`
        expect(css, `${preset} ${cssVar}-light`).toContain(`${cssVar}-light:`)
        expect(css, `${preset} ${cssVar}-dark`).toContain(`${cssVar}-dark:`)
      }
    })
  }
})

describe('modern preset ↔ stylesheet sync', () => {
  // The default `modern` preset and the raw `--color-*-light`/`-dark` variables
  // declared in globals.css are two copies of one palette. This test fails if
  // they drift, enforcing the "un-driftable" goal (ADR-0015) for the token set
  // the stylesheet ships as its baked-in default.
  const globalsCss = readFileSync(join(import.meta.dirname, '../../src/styles/globals.css'), 'utf8')

  const declaredRawVars = (suffix: 'light' | 'dark'): string[] => {
    const matches = globalsCss.matchAll(new RegExp(`--color-([a-z-]+)-${suffix}\\s*:`, 'g'))
    return [...matches].map((m) => `--color-${m[1]}-${suffix}`).sort()
  }

  const compiledVars = (suffix: 'light' | 'dark'): string[] => {
    const css = compileTheme({ preset: 'modern' })
    const matches = css.matchAll(new RegExp(`(--color-[a-z-]+-${suffix})\\s*:`, 'g'))
    return [...matches].map((m) => m[1]).sort()
  }

  for (const suffix of ['light', 'dark'] as const) {
    it(`declares the same ${suffix} color variables the modern preset emits`, () => {
      expect(declaredRawVars(suffix)).toEqual(compiledVars(suffix))
    })
  }
})

describe('preset shape & elevation', () => {
  it('classic is flat: removes elevation and squares the radius', () => {
    const css = compileTheme({ preset: 'classic' })
    expect(css).toContain('--shadow-sm: none;')
    expect(css).toContain('--shadow-md: none;')
    expect(css).toContain('--shadow-lg: none;')
    expect(css).toContain('--radius: 0.375rem;')
  })

  it('classic is gradient-free: both gradient stops are the primary', () => {
    const css = compileTheme({ preset: 'classic' })
    expect(css).toContain('--color-gradient-from-light: hsl(221 83% 53%);')
    expect(css).toContain('--color-gradient-to-light: hsl(221 83% 53%);')
  })

  it('neon keeps its high-chroma cyan/purple/pink identity and rounder radius', () => {
    const css = compileTheme({ preset: 'neon' })
    // pink primary
    expect(css).toContain('--color-primary-light: hsl(330 100% 50%);')
    // purple accent
    expect(css).toContain('--color-accent-light: hsl(280 100% 60%);')
    // cyan → pink signature gradient
    expect(css).toContain('--color-gradient-from-light: hsl(190 100% 50%);')
    expect(css).toContain('--color-gradient-to-light: hsl(320 100% 55%);')
    expect(css).toContain('--radius: 0.75rem;')
  })

  it('modern inherits stylesheet shape and elevation (emits neither)', () => {
    const css = compileTheme({ preset: 'modern' })
    expect(css).not.toContain('--radius:')
    expect(css).not.toContain('--shadow-')
  })
})
