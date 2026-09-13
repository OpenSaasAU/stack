import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.turbo'])
const HASH_FILE_NAME = '.build-hash'

function isTestFile(fileName) {
  return /\.(test|spec)\.tsx?$/.test(fileName)
}

function listSourceFiles(srcDir) {
  if (!existsSync(srcDir)) return []
  const files = []
  const stack = [srcDir]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
          stack.push(join(current, entry.name))
        }
        continue
      }
      if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue
      if (isTestFile(entry.name)) continue
      files.push(join(current, entry.name))
    }
  }
  return files.sort()
}

/**
 * A content hash, not an mtime comparison: `git checkout`/`pull`/`rebase`
 * routinely rewrite a file's mtime to "now" with byte-identical content, which
 * an mtime-based staleness check would report as needing a rebuild that
 * `pnpm build` can never clear (tsc's own incremental build correctly does
 * nothing for unchanged content, so dist's mtime never catches up). Hashing
 * `src/` content directly is immune to that class of false positive.
 */
function hashSourceTree(srcDir) {
  const hash = createHash('sha256')
  for (const file of listSourceFiles(srcDir)) {
    hash.update(relative(srcDir, file))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/**
 * Call at the end of a package's own `build` script (after `tsc`) to record
 * what `dist/` was built from. `assertDistFresh` below compares against this.
 */
export function writeBuildHash(packageDir) {
  writeFileSync(join(packageDir, 'dist', HASH_FILE_NAME), hashSourceTree(join(packageDir, 'src')))
}

/**
 * Throws when a package's `dist/` was not built from its current `src/`
 * (test files excluded — a rebuild is never what makes a test-only edit
 * observable elsewhere). A suite that drives a package's built output — a
 * spawned CLI binary, a plain `import` of another workspace package's
 * published entry point — reads a stale `dist/` silently otherwise, which is
 * exactly the false negative issue #1302 documents: a mutation planted in
 * `src/` to prove a test is falsifiable never reaches the code under test.
 *
 * `packageDirs` are absolute paths to package roots, each holding its own
 * `src/` and (once built) `dist/.build-hash`, written by `writeBuildHash`.
 */
export function assertDistFresh(packageDirs) {
  const stale = []
  for (const dir of packageDirs) {
    const srcDir = join(dir, 'src')
    if (!existsSync(srcDir)) continue
    const hashFile = join(dir, 'dist', HASH_FILE_NAME)
    const builtHash = existsSync(hashFile) ? readFileSync(hashFile, 'utf8').trim() : null
    const currentHash = hashSourceTree(srcDir)
    if (builtHash !== currentHash) stale.push(dir)
  }
  if (stale.length === 0) return

  throw new Error(
    [
      'Stale build detected — this suite loads built `dist/` output, not `src/`, for:',
      ...stale.map((dir) => `  - ${dir}`),
      '',
      'A `src/` edit — including one made only to check that a test is falsifiable — has',
      'no effect here until the package is rebuilt. Run `pnpm build` in each listed',
      'package (or `pnpm build` at the repo root) before re-running this suite.',
    ].join('\n'),
  )
}
