import fs from 'fs'
import path from 'path'

const CORE_PACKAGE_JSON = path.join(process.cwd(), '..', 'packages', 'core', 'package.json')

let cachedVersion: string | undefined

// `packages/core/package.json`'s version only moves forward when a release
// actually bumps it (changesets), so it is the last version npm published —
// unlike prose, it can't drift ahead of what `npm install` actually gives a reader.
export function getPublishedCoreVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion

  const raw = fs.readFileSync(CORE_PACKAGE_JSON, 'utf-8')
  const parsed: unknown = JSON.parse(raw)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    typeof parsed.version !== 'string'
  ) {
    throw new Error(`${CORE_PACKAGE_JSON} has no string "version" field`)
  }

  cachedVersion = parsed.version
  return cachedVersion
}
