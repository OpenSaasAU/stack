import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { assertDistFresh } from '../../scripts/lib/dist-freshness.mjs'

const packageRoot = path.dirname(fileURLToPath(import.meta.url))
const packagesRoot = path.resolve(packageRoot, '..')

// This suite imports `@opensaas/stack-core` and `@opensaas/stack-ui` by
// package name, both resolved through `dist/`, never `src/`. See issue #1302.
export default function setup() {
  assertDistFresh(['core', 'ui'].map((name) => path.join(packagesRoot, name)))
}
