import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { assertDistFresh } from '../../scripts/lib/dist-freshness.mjs'

const packageRoot = path.dirname(fileURLToPath(import.meta.url))
const packagesRoot = path.resolve(packageRoot, '..')

// The e2e guards import `@opensaas/stack-auth` and `@opensaas/stack-core` by
// package name, both resolved through `dist/`, never `src/`. See issue #1302.
export default function setup() {
  assertDistFresh(['auth', 'core'].map((name) => path.join(packagesRoot, name)))
}
