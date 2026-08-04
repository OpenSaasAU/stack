import { defineConfig, defaultExclude } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    // The `test` turbo task depends on `build`, so a `dist/` directory is
    // present when tests run in CI. Without this exclusion Vitest would also
    // discover the compiled `dist/**/*.test.js` duplicate of the colocated
    // type-level test in `src/server/`. Preserve Vitest's defaults and
    // additionally ignore `dist`.
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
        'src/ui/**',
        'src/client/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
