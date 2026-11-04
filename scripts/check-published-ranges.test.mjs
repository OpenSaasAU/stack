import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const command = fileURLToPath(new URL('./check-published-ranges.mjs', import.meta.url))

function advisory(module_name, vulnerable_versions, patched_versions) {
  return {
    module_name,
    vulnerable_versions,
    patched_versions,
    severity: 'moderate',
    github_advisory_id: `GHSA-${module_name}`,
    url: `https://github.com/advisories/GHSA-${module_name}`,
  }
}

function runCheck(t, { manifests, audit }) {
  const directory = mkdtempSync(join(tmpdir(), 'published-ranges-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  for (const [path, manifest] of Object.entries(manifests)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true })
    writeFileSync(join(directory, path), JSON.stringify(manifest))
  }
  if (audit !== undefined) {
    writeFileSync(join(directory, 'security-audit.json'), JSON.stringify(audit))
  }
  const env = { ...process.env }
  delete env.GITHUB_STEP_SUMMARY
  return spawnSync(process.execPath, [command], { cwd: directory, env, encoding: 'utf8' })
}

const vulnerable = (...advisories) => ({
  status: 'vulnerable',
  audit: { advisories: Object.fromEntries(advisories.map((entry, index) => [index, entry])) },
})

test('a published range that excludes every patched version blocks release', (t) => {
  const result = runCheck(t, {
    manifests: { 'packages/cli/package.json': { name: 'cli', dependencies: { glob: '^13.0.6' } } },
    audit: vulnerable(advisory('glob', '>=9.0.0 <=14.0.1', '>=14.0.2')),
  })
  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stdout, /FAIL.*\n.*packages\/cli\/package\.json dependencies glob@\^13\.0\.6/)
})

test('a published range that admits a patched version permits release', (t) => {
  const result = runCheck(t, {
    manifests: { 'packages/core/package.json': { name: 'core', dependencies: { zod: '^4.6.5' } } },
    audit: vulnerable(advisory('zod', '<4.6.6', '>=4.6.6')),
  })
  assert.equal(result.status, 0, result.stdout)
  assert.match(result.stdout, /PASS/)
})

test('a range outside the vulnerable versions is not affected by the advisory', (t) => {
  const result = runCheck(t, {
    manifests: { 'packages/a/package.json': { name: 'a', dependencies: { lib: '^3.0.0' } } },
    audit: vulnerable(advisory('lib', '<2.0.0', '>=1.9.9 <2.0.0')),
  })
  assert.equal(result.status, 0, result.stdout)
})

test('dev dependencies and private packages never block release', (t) => {
  const result = runCheck(t, {
    manifests: {
      'packages/a/package.json': { name: 'a', devDependencies: { vite: '7.3.6' } },
      'packages/internal/package.json': {
        name: 'internal',
        private: true,
        dependencies: { vite: '7.3.6' },
      },
    },
    audit: vulnerable(advisory('vite', '<=7.3.6', '>=7.3.7')),
  })
  assert.equal(result.status, 0, result.stdout)
})

test('peer and optional ranges are checked like dependencies', (t) => {
  for (const field of ['peerDependencies', 'optionalDependencies']) {
    const result = runCheck(t, {
      manifests: { 'packages/a/package.json': { name: 'a', [field]: { lib: '1.0.0' } } },
      audit: vulnerable(advisory('lib', '<1.0.1', '>=1.0.1')),
    })
    assert.equal(result.status, 1, `${field}: ${result.stdout}`)
  }
})

test('the scaffolder template sources are checked because their ranges ship in templates', (t) => {
  const result = runCheck(t, {
    manifests: {
      'examples/starter/package.json': {
        name: 'starter',
        private: true,
        dependencies: { next: '~16.3.0' },
      },
    },
    audit: vulnerable(advisory('next', '<16.4.0', '>=16.4.0')),
  })
  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stdout, /examples\/starter\/package\.json/)
})

test('a pinned prerelease inside the vulnerable range blocks release', (t) => {
  const result = runCheck(t, {
    manifests: { 'packages/a/package.json': { name: 'a', dependencies: { orm: '8.0.0-rc.1' } } },
    audit: vulnerable(advisory('orm', '<8.0.1', '>=8.0.1')),
  })
  assert.equal(result.status, 1, result.stdout)
})

test('workspace and non-semver ranges are skipped', (t) => {
  const result = runCheck(t, {
    manifests: {
      'packages/a/package.json': {
        name: 'a',
        dependencies: { b: 'workspace:*', c: 'npm:lib@1.0.0', d: 'github:o/r' },
      },
    },
    audit: vulnerable(advisory('b', '<9.0.0', '>=9.0.0'), advisory('d', '<9.0.0', '>=9.0.0')),
  })
  assert.equal(result.status, 0, result.stdout)
})

test('an advisory with no patched version warns without blocking release', (t) => {
  const result = runCheck(t, {
    manifests: { 'packages/a/package.json': { name: 'a', dependencies: { braces: '^3.0.3' } } },
    audit: vulnerable(advisory('braces', '<=3.0.3', '<0.0.0')),
  })
  assert.equal(result.status, 0, result.stdout)
  assert.match(result.stdout, /WARNING.*no patched version.*braces@\^3\.0\.3/)
})

test('a missing or unavailable audit blocks release as unavailable', (t) => {
  const manifests = { 'packages/a/package.json': { name: 'a', dependencies: {} } }
  assert.equal(runCheck(t, { manifests }).status, 2)
  const unavailable = runCheck(t, {
    manifests,
    audit: { status: 'unavailable', error: 'ENOTFOUND' },
  })
  assert.equal(unavailable.status, 2)
  assert.match(unavailable.stdout, /UNAVAILABLE/)
})
