// Plain-Node verification consumer for the Node build (ADR-0011 / #579).
//
// This script is the in-repo consumer that anchors the Node build: it imports
// the COMPILED bundle (`.opensaas/dist/context.js`) under plain Node — NO
// bundler, NO tsx — wires better-auth's Prisma adapter through it via
// `createAuth`, and creates a user. It mirrors the failing downstream trace in
// #579, where pointing better-auth at the stack client routed through a runtime
// `import('.opensaas/context.ts')` that plain Node could not load.
//
// Run directly with `node scripts/node-build-create-user.mjs` (it is a `.mjs`
// file run by the `node` binary). On success it prints `NODE_BUILD_OK <id>` and
// exits 0; on failure it prints `NODE_BUILD_FAIL ...` and exits 1. The e2e spec
// asserts on that contract.
//
// Requires (set by the e2e harness / global-setup):
//   - `pnpm generate` to have emitted `.opensaas/dist/` (needs
//     `output: { buildTarget: 'node' }` in opensaas.config.ts)
//   - `pnpm db:push` to have created the SQLite database
//   - DATABASE_URL / BETTER_AUTH_SECRET / BETTER_AUTH_URL in the environment

import { createAuth } from '@opensaas/stack-auth/server'
// The load-bearing line: a plain-Node `import` of the COMPILED entry. The `.js`
// specifier resolves natively because `.opensaas/dist/package.json` marks the
// directory `{"type":"module"}`. No `.ts` is touched at runtime.
import { config, rawOpensaasContext } from '../.opensaas/dist/context.js'

async function main() {
  const auth = createAuth(config, rawOpensaasContext)
  const email = `node-build-${Date.now()}@example.com`

  const result = await auth.api.signUpEmail({
    body: { email, password: 'password12345', name: 'Node Build' },
  })

  if (!result || !result.user || result.user.email !== email) {
    console.error('NODE_BUILD_FAIL user not created', JSON.stringify(result))
    process.exit(1)
  }

  console.log(`NODE_BUILD_OK ${result.user.id}`)
  process.exit(0)
}

main().catch((err) => {
  console.error('NODE_BUILD_FAIL', err?.stack || String(err))
  process.exit(1)
})
