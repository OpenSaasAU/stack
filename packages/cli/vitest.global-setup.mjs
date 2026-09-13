import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { assertDistFresh } from '../../scripts/lib/dist-freshness.mjs'

const packageRoot = path.dirname(fileURLToPath(import.meta.url))
const packagesRoot = path.resolve(packageRoot, '..')

// This suite spawns the built `bin/opensaas.js` (which loads its own and
// core's `dist/`) and imports `@opensaas/stack-core`, `@opensaas/stack-storage`
// and `@opensaas/stack-tiptap` directly by package name — all resolved
// through `dist/`, never `src/`. See issue #1302.
export default function setup() {
  assertDistFresh(['cli', 'core', 'storage', 'tiptap'].map((name) => path.join(packagesRoot, name)))
}
