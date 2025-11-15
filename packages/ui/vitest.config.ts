import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Exclude browser tests from regular test runs
    exclude: process.env.BROWSER_TEST === 'true' ? [] : ['**/browser/**'],
    // Include only browser tests when in browser mode
    include:
      process.env.BROWSER_TEST === 'true'
        ? ['tests/browser/**/*.test.{ts,tsx}']
        : ['tests/**/*.test.{ts,tsx}', '!tests/browser/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'json-summary'],
      exclude: ['node_modules/', 'tests/', 'dist/', '**/*.d.ts', '**/*.config.*', '**/index.ts'],
    },
    // Browser mode configuration
    browser: {
      enabled: process.env.BROWSER_TEST === 'true',
      instances: [
        {
          browser: 'chromium',
        },
      ],
      provider: playwright(),
      headless: true,
      screenshotFailures: true,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
