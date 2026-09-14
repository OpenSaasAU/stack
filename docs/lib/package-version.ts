import fs from 'fs'
import path from 'path'

const CORE_PACKAGE_JSON = path.join(process.cwd(), '..', 'packages', 'core', 'package.json')

// `packages/core/package.json`'s version only moves forward when a release
// actually bumps it (changesets), so it is the last version npm published —
// unlike prose, it can't drift ahead of what `npm install` actually gives a reader.
export function getPublishedCoreVersion(): string {
  const raw = fs.readFileSync(CORE_PACKAGE_JSON, 'utf-8')
  const { version } = JSON.parse(raw) as { version: string }
  return version
}
