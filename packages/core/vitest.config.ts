import { defineConfig, defaultExclude } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    // The `test` turbo task depends on `build`, so a `dist/` directory is
    // present when tests run in CI. Without this exclusion Vitest would also
    // discover the compiled `dist/**/*.test.js` duplicates and inflate the
    // reported test/file count. Preserve Vitest's defaults and additionally
    // ignore `dist`. Rationale: docs/adr/0002-testing-and-ci-strategy.md.
    exclude: [...defaultExclude, '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'json-summary'],
      exclude: [
        'node_modules/',
        'tests/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/index.ts',
        'bin/',
        'generator/',
      ],
      // Per-glob, per-file coverage gates on the security-critical core paths:
      // the access-control engine (`src/access`), the read/write context
      // pipeline (`src/context` — Write Pipeline, Hook Pipeline, nested-op
      // registry), and the config validator (`src/validation`). `perFile: true`
      // applies each threshold to every covered file in the glob, so the
      // numbers sit a couple of points below the *current lowest-covered file*
      // in each group — a real regression fails `test:coverage` (and the PR),
      // while normal variance does not. Other packages stay report-only.
      // Rationale: docs/adr/0002-testing-and-ci-strategy.md.
      thresholds: {
        perFile: true,
        // Lowest current file: field-access.ts (stmts/lines 69.76, branch
        // 56.41, funcs 66.66).
        'src/access/**': {
          statements: 65,
          branches: 50,
          functions: 62,
          lines: 65,
        },
        // Lowest current file: nested-operations.ts (stmts/lines 89.47,
        // branch 69.23, funcs 100).
        'src/context/**': {
          statements: 85,
          branches: 65,
          functions: 90,
          lines: 85,
        },
        // Lowest current file: field-config.ts (stmts 96.42, branch 87.50,
        // funcs 100, lines 100).
        'src/validation/**': {
          statements: 92,
          branches: 83,
          functions: 95,
          lines: 95,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
