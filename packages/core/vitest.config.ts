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
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/index.ts',
        'bin/',
        'generator/',
      ],
      // Per-glob, per-file coverage gates on the security-critical core paths:
      // the access-control engine (`src/access`), the read/write context
      // pipeline (`src/context` — Write Pipeline, Hook Pipeline, the
      // transaction bracket), and the config validator (`src/validation`). `perFile: true`
      // applies each threshold to every covered file in the glob, so the
      // numbers sit a couple of points below the *current lowest-covered file*
      // in each group — a real regression fails `test:coverage` (and the PR),
      // while normal variance does not. Other packages stay report-only.
      // Rationale: docs/adr/0002-testing-and-ci-strategy.md.
      thresholds: {
        perFile: true,
        // Re-baselined once against the corpus rewritten by guarantee
        // (#1156, ADR-0057, ADR-0002). No number here was lowered.
        //
        // Lowest current files: query-validation.ts (stmts 78.90, branch
        // 73.27, lines 83.63) and field-access.ts (funcs 80).
        'src/access/**': {
          statements: 76,
          branches: 71,
          functions: 78,
          lines: 81,
        },
        // Lowest current files: relationship-input.ts (stmts 88.49, funcs
        // 94.11, lines 92.13) and transaction-boundary.ts (branch 82).
        'src/context/**': {
          statements: 86,
          branches: 80,
          functions: 92,
          lines: 90,
        },
        // Lowest current files: field-names.ts (stmts 93.87, lines 95.23),
        // extension-packs.ts (branch 88.23), database-config.ts (funcs 100).
        'src/validation/**': {
          statements: 92,
          branches: 86,
          functions: 98,
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
