import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { assertDistFresh } from '../../scripts/lib/dist-freshness.mjs'

const packageRoot = path.dirname(fileURLToPath(import.meta.url))
const packagesRoot = path.resolve(packageRoot, '..')

// This suite imports `@opensaas/stack-storage` by package name, resolved
// through its `dist/`, never `src/`. See issue #1302.
export default function setup() {
  assertDistFresh(['storage'].map((name) => path.join(packagesRoot, name)))
}
