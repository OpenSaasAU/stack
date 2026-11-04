// Blocks a release when a published manifest's dependency range excludes every
// patched version of a known advisory. See specs/release-security-audit.md.
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import semver from 'semver'

const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']
const PRERELEASE = { includePrerelease: true }
const TEMPLATE_SOURCES = ['examples/starter', 'examples/starter-auth']

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function publishedManifests(root) {
  const packagesDir = join(root, 'packages')
  const packages = existsSync(packagesDir)
    ? readdirSync(packagesDir)
        .map((name) => join('packages', name, 'package.json'))
        .filter((path) => existsSync(join(root, path)))
        .filter((path) => readJson(join(root, path)).private !== true)
    : []
  const templates = TEMPLATE_SOURCES.map((dir) => join(dir, 'package.json')).filter((path) =>
    existsSync(join(root, path)),
  )
  return [...packages, ...templates]
}

function declaredRanges(manifest) {
  return DEPENDENCY_FIELDS.flatMap((field) =>
    Object.entries(manifest[field] ?? {}).map(([name, range]) => ({ field, name, range })),
  )
}

function report(message) {
  console.log(message)
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + '\n')
}

function main(root) {
  const auditPath = join(root, 'security-audit.json')
  if (!existsSync(auditPath)) {
    report('Published range check: UNAVAILABLE — no security-audit.json; run the audit first.')
    return 2
  }
  const { status, audit } = readJson(auditPath)
  if (status === 'unavailable' || !audit?.advisories) {
    report('Published range check: UNAVAILABLE — the advisory audit did not complete.')
    return 2
  }

  const advisories = Object.values(audit.advisories)
  const blocking = []
  const unpatched = []
  for (const manifestPath of publishedManifests(root)) {
    const manifest = readJson(join(root, manifestPath))
    for (const { field, name, range } of declaredRanges(manifest)) {
      if (semver.validRange(range) === null) continue
      for (const advisory of advisories) {
        if (advisory.module_name !== name) continue
        if (!semver.intersects(range, advisory.vulnerable_versions, PRERELEASE)) continue
        const entry =
          `${manifestPath} ${field} ${name}@${range} — ${advisory.severity} ${advisory.github_advisory_id ?? advisory.id} (vulnerable ${advisory.vulnerable_versions}, patched ${advisory.patched_versions}) ${advisory.url ?? ''}`.trim()
        const patched = advisory.patched_versions
        if (semver.validRange(patched) === null || semver.minVersion(patched) === null) {
          unpatched.push(entry)
        } else if (!semver.intersects(range, patched, PRERELEASE)) {
          blocking.push(entry)
        }
      }
    }
  }

  for (const entry of unpatched)
    report(`Published range check: WARNING — no patched version exists: ${entry}`)
  if (blocking.length > 0) {
    report(
      `Published range check: FAIL — ${blocking.length} declared range(s) exclude every patched version:\n` +
        blocking.map((entry) => `  ${entry}`).join('\n'),
    )
    return 1
  }
  report('Published range check: PASS — every published range admits a patched version.')
  return 0
}

process.exitCode = main(process.cwd())
