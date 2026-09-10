import { defineConfig, defaultExclude } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    // The `test` turbo task depends on `build`, so `dist/` is present when
    // tests run in CI. Without this exclusion Vitest also discovers the
    // compiled `dist/**/*.test.js` duplicates and runs every test twice
    // (#1311). Preserve Vitest's defaults and additionally ignore `dist`.
    exclude: [...defaultExclude, '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'json-summary'],
      exclude: ['node_modules/', 'tests/', 'dist/', '**/*.d.ts', '**/*.config.*', '**/index.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
