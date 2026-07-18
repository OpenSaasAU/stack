/*
 * Codegen: emit the baked-in `modern`-preset color defaults in
 * `src/styles/globals.css` from the single source of truth — `presetThemes.modern`
 * in `src/lib/theme.ts`.
 *
 * Why: the default `modern` baseline used to live in two hand-maintained copies
 * (the preset catalog AND the raw `--color-*-light`/`-dark` `:root` vars),
 * reconciled only by a test that CAUGHT drift after the fact. This script makes
 * the stylesheet's copy DERIVED, so the two can never diverge (issue #714).
 *
 * The generated region is delimited by the `stack:generated-*` marker comments
 * in globals.css; everything outside them (the `@theme` contract tokens, the
 * radius knob, the dark-mode mechanism, body styles) stays hand-written.
 *
 * Run directly (`pnpm --filter @opensaas/stack-ui generate:css`) or as the first
 * step of `build`. `--check` mode verifies the checked-in file is already in sync
 * (used by the test suite) instead of writing.
 *
 * Runs on Node's native TypeScript type-stripping — `presetThemes` uses only
 * `import type`, so importing `theme.ts` here pulls in no runtime dependencies.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { presetThemes } from '../src/lib/theme.ts'
import type { ThemeColors } from '@opensaas/stack-core/internal'

const START_MARKER = '  /* stack:generated-start modern-preset-colors */'
const END_MARKER = '  /* stack:generated-end modern-preset-colors */'

/** camelCase token key → kebab-case CSS variable segment (matches lib/theme.ts). */
function toKebabCase(key: string): string {
  return key.replace(/([A-Z])/g, '-$1').toLowerCase()
}

function emitBlock(colors: ThemeColors, suffix: 'light' | 'dark'): string {
  return Object.entries(colors)
    .map(([key, value]) => `  --color-${toKebabCase(key)}-${suffix}: ${value};`)
    .join('\n')
}

/**
 * The full generated region body (between the marker lines). Derived entirely
 * from `presetThemes.modern`, so re-tuning the preset is the only edit needed.
 */
function generateRegion(): string {
  const { light, dark } = presetThemes.modern
  return [
    '  /* GENERATED from `presetThemes.modern` in lib/theme.ts — the single source',
    '     of truth for the baked-in default palette. Do NOT edit these values by',
    '     hand; run `pnpm --filter @opensaas/stack-ui generate:css` (also runs on',
    '     build). See issue #714. */',
    '',
    '  /* Modern preset — light. Restrained, low-chroma surfaces with one saturated',
    '     brand color. */',
    emitBlock(light, 'light'),
    '',
    '  /* Modern preset — dark. */',
    emitBlock(dark, 'dark'),
  ].join('\n')
}

function render(existing: string, region: string): string {
  const startIndex = existing.indexOf(START_MARKER)
  const endIndex = existing.indexOf(END_MARKER)
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(
      `generate-globals-css: could not find the "${START_MARKER.trim()}" / ` +
        `"${END_MARKER.trim()}" markers in globals.css.`,
    )
  }
  const before = existing.slice(0, startIndex + START_MARKER.length)
  const after = existing.slice(endIndex)
  return `${before}\n${region}\n${after}`
}

const CSS_PATH = join(dirname(fileURLToPath(import.meta.url)), '../src/styles/globals.css')

function main(): void {
  const existing = readFileSync(CSS_PATH, 'utf8')
  const next = render(existing, generateRegion())
  const check = process.argv.includes('--check')

  if (next === existing) {
    return
  }

  if (check) {
    console.error(
      'globals.css is out of sync with presetThemes.modern.\n' +
        'Run `pnpm --filter @opensaas/stack-ui generate:css` and commit the result.',
    )
    process.exit(1)
  }

  writeFileSync(CSS_PATH, next)
  console.log('generate-globals-css: wrote src/styles/globals.css')
}

main()
