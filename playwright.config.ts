import { defineConfig, devices } from '@playwright/test'
import { exampleDatabaseUrl } from './e2e/utils/db.js'
import { assertRequiredEnv } from './e2e/utils/required-env.js'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

assertRequiredEnv()

/**
 * A webServer `env` override for one example's own database, or none.
 *
 * `webServer.env` merges into `process.env` rather than replacing it, so a
 * bare `DATABASE_URL` override would lose to an inherited `DIRECT_DATABASE_URL`
 * — the app's own lookup (`packages/core/src/db/url.ts`) checks that one
 * first. Clearing it here (the lookup treats an empty value as unset) makes
 * `DATABASE_URL` the one the app actually finds, whichever was originally set.
 */
function databaseEnvFor(
  databaseName: string,
): { DATABASE_URL: string; DIRECT_DATABASE_URL: string } | undefined {
  const url = exampleDatabaseUrl(databaseName)
  return url ? { DATABASE_URL: url, DIRECT_DATABASE_URL: '' } : undefined
}

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI ? 'github' : 'html',
  /* Global setup and teardown */
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /**
   * The production build, served under the dev loop. Playwright starts this
   * before `globalSetup`, so the loop is what brings the database up before
   * the app: `opensaas dev` starts the Dev database (or takes `DATABASE_URL`),
   * reconciles it, and only then spawns `next start`. A server that boots
   * with no database leaves `createAuth`'s module-scope context rejected for
   * the life of the process. The data directory is cleared first so every run
   * begins empty — the specs create rows under fixed slugs.
   */
  webServer: [
    {
      command:
        'cd examples/starter-auth && rm -rf .opensaas/dev-db && DISABLE_RATE_LIMITING=true pnpm build && DISABLE_RATE_LIMITING=true pnpm exec opensaas dev -- next start',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 180000, // 3 minutes - Next.js can take time to build and start
      stdout: 'pipe', // Capture server output for debugging
      stderr: 'pipe',
    },
    /**
     * Neither example below wires `authPlugin`, so none of the starter-auth
     * server's env or rate-limiting concerns apply. Each registers a custom
     * field component (`examples/json-demo`'s `jsonEditor`/`taxonomy`,
     * `examples/tiptap-demo`'s `richText`) — the shape #1398 exists to cover:
     * a broken registration passes generate, build, tsc and every suite, and
     * only rendering the admin form catches it.
     */
    {
      command:
        'cd examples/json-demo && rm -rf .opensaas/dev-db && pnpm build && pnpm exec opensaas dev -- next start -p 3005',
      // `/admin` rather than the bare root: `examples/tiptap-demo` has no
      // root `app/page.tsx` at all, so its own root 404s and the readiness
      // probe never succeeds. Both examples serve `/admin` directly (200).
      url: 'http://localhost:3005/admin',
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: databaseEnvFor('json_demo_example'),
    },
    {
      command:
        'cd examples/tiptap-demo && rm -rf .opensaas/dev-db && pnpm build && pnpm exec opensaas dev -- next start -p 3002',
      url: 'http://localhost:3002/admin',
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: databaseEnvFor('tiptap_demo_example'),
    },
  ],
})
