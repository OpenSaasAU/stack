/**
 * The env vars the starter-auth webServer needs to boot (better-auth refuses
 * to construct without `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`, and the client
 * bundle needs `NEXT_PUBLIC_APP_URL` at build time). CI sets these at the job
 * level; a local run has nothing to inherit them from.
 *
 * `global-setup.ts` writes these same defaults into `examples/starter-auth/.env`
 * — but only after Playwright's `webServer` has already tried to start, so
 * that alone can't get the values to the server's first boot. See
 * `assertRequiredEnv`.
 */
export const REQUIRED_ENV: readonly (readonly [string, string])[] = [
  ['BETTER_AUTH_SECRET', 'test-secret-key-for-e2e-tests-only-not-for-production-use'],
  ['BETTER_AUTH_URL', 'http://localhost:3000'],
  ['NEXT_PUBLIC_APP_URL', 'http://localhost:3000'],
]

/**
 * Fails the whole run once, before `webServer` spawns, naming exactly which
 * variable is missing — instead of a run where the server fails to boot and
 * every one of the ~55 specs times out with no shared explanation (issue
 * #1419). See `e2e/README.md`'s Environment Variables section for values that
 * work locally.
 */
export function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV.filter(([key]) => !process.env[key]).map(([key]) => key)
  if (missing.length === 0) return

  throw new Error(
    `e2e: missing required environment variable(s): ${missing.join(', ')}.\n` +
      'These must be set in the shell that runs `pnpm test:e2e` — the starter-auth ' +
      "webServer needs them to boot, which happens before Playwright's own global " +
      "setup gets a chance to default them. See e2e/README.md's Environment " +
      'Variables section for values that work locally.',
  )
}
