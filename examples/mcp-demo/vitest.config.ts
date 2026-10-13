import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each file stands up its own Dev database instance, so the boot cost is
    // paid per file rather than per test.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
