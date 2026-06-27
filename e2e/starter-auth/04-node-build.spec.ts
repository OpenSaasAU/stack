import { test, expect } from '@playwright/test'
import { spawnSync } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

/**
 * Node build verification (ADR-0011 / #579).
 *
 * The Node build is the opt-in compiled form of the generated `.opensaas/`
 * bundle, emitted to `.opensaas/dist/` when `output: { buildTarget: 'node' }`
 * is set. It exists so a live module (better-auth's Prisma adapter) can be
 * imported in a bundler-less runtime — exactly the path that regressed in #579.
 *
 * These tests prove the property that matters: the COMPILED bundle loads under
 * **plain Node** — no bundler, no tsx — and better-auth creates a user through
 * it. The compiled `.opensaas/dist/` is produced by global-setup, which runs
 * `pnpm generate && pnpm db:push` against the example (whose config opts into
 * the Node build).
 */

const exampleDir = path.join(process.cwd(), 'examples/starter-auth')
const distDir = path.join(exampleDir, '.opensaas/dist')

test.describe('Node build (#579)', () => {
  test('emits a plain-Node-loadable bundle to .opensaas/dist', async () => {
    // The compiled entry, the prisma-client subtree, and the ESM marker.
    expect(fs.existsSync(path.join(distDir, 'context.js'))).toBe(true)
    expect(fs.existsSync(path.join(distDir, 'context.d.ts'))).toBe(true)
    expect(fs.existsSync(path.join(distDir, 'prisma-client/client.js'))).toBe(true)

    // `{"type":"module"}` marks the emitted `.js` as unambiguous ESM.
    const pkg = JSON.parse(fs.readFileSync(path.join(distDir, 'package.json'), 'utf-8'))
    expect(pkg).toEqual({ type: 'module' })

    // The compiled entry must carry runnable `.js` specifiers (the `.ts`
    // extensions of the source bundle are rewritten), and import the config
    // from inside `dist/` so the build is self-contained under plain Node.
    const entry = fs.readFileSync(path.join(distDir, 'context.js'), 'utf-8')
    expect(entry).toMatch(/from ['"]\.\/prisma-client\/client\.js['"]/)
    expect(entry).toMatch(/from ['"]\.\/opensaas\.config\.js['"]/)
    expect(entry).not.toContain('.ts.js')
    expect(entry).not.toContain('prisma-client/client.ts')
  })

  test('better-auth creates a user importing the compiled bundle under plain Node', async () => {
    // Spawn the real `node` binary on a `.mjs` consumer — no bundler, no tsx in
    // the load path. The script imports `.opensaas/dist/context.js` and creates
    // a user through better-auth, mirroring the failing #579 trace.
    const script = path.join(exampleDir, 'scripts/node-build-create-user.mjs')
    expect(fs.existsSync(script)).toBe(true)

    const result = spawnSync(process.execPath, [script], {
      cwd: exampleDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL || 'file:./dev.db',
        BETTER_AUTH_SECRET:
          process.env.BETTER_AUTH_SECRET ||
          'test-secret-key-for-e2e-tests-only-not-for-production-use',
        BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
        DISABLE_RATE_LIMITING: 'true',
      },
    })

    const output = `${result.stdout}\n${result.stderr}`
    expect(output, output).toContain('NODE_BUILD_OK')
    expect(result.status).toBe(0)
  })
})
