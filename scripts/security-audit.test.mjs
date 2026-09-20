import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const command = fileURLToPath(new URL('./security-audit.mjs', import.meta.url))
const clean = {
  advisories: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } },
}

function runAudit(t, response, exitCode = 0, raw = false) {
  const directory = mkdtempSync(join(tmpdir(), 'security-audit-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(
    join(directory, 'pnpm'),
    `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(raw ? response : JSON.stringify(response))}); process.exit(${exitCode})\n`,
    { mode: 0o755 },
  )
  const summary = join(directory, 'summary.md')
  const result = spawnSync(process.execPath, [command], {
    cwd: directory,
    env: { ...process.env, PATH: directory, GITHUB_STEP_SUMMARY: summary },
    encoding: 'utf8',
  })
  return {
    ...result,
    report: () => JSON.parse(readFileSync(join(directory, 'security-audit.json'), 'utf8')),
    summary: () => readFileSync(summary, 'utf8'),
  }
}

test('a completed clean advisory audit permits release and saves its evidence', (t) => {
  const result = runAudit(t, clean)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Security advisory audit: PASS/)
  assert.equal(result.report().status, 'pass')
  assert.deepEqual(result.report().audit, clean)
  assert.match(result.summary(), /Security advisory audit: PASS/)
})

test('known vulnerabilities block release and remain available for triage', (t) => {
  const vulnerable = {
    advisories: { 123: { title: 'Fixture vulnerability', severity: 'high' } },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } },
  }
  const result = runAudit(t, vulnerable, 1)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /Security advisory audit: FAIL.*1 high/)
  assert.equal(result.report().status, 'vulnerable')
  assert.deepEqual(result.report().audit, vulnerable)
  assert.match(result.summary(), /Security advisory audit: FAIL/)
})

test('an unreachable advisory registry blocks release with an explicit unavailable result', (t) => {
  const response = {
    error: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND registry.npmjs.org' },
  }
  const result = runAudit(t, response, 1)
  assert.equal(result.status, 2)
  assert.match(result.stdout, /Security advisory audit: UNAVAILABLE/)
  assert.equal(result.report().status, 'unavailable')
  assert.deepEqual(result.report().audit, response)
  assert.match(result.summary(), /UNAVAILABLE.*release blocked/)
})

test('a malformed registry response cannot appear as a successful audit', (t) => {
  const result = runAudit(t, '<html>Gateway unavailable</html>', 0, true)
  assert.equal(result.status, 2)
  assert.equal(result.report().status, 'unavailable')
  assert.match(result.report().error, /JSON/)
  assert.match(result.stdout, /UNAVAILABLE/)
})

test('an incomplete report cannot claim vulnerability coverage', (t) => {
  const result = runAudit(t, { metadata: { vulnerabilities: {} } })
  assert.equal(result.status, 2)
  assert.equal(result.report().status, 'unavailable')
  assert.match(result.report().error, /incomplete/)
})

test('a failed audit process cannot pass using a clean-looking report', (t) => {
  const result = runAudit(t, clean, 1)
  assert.equal(result.status, 2)
  assert.equal(result.report().status, 'unavailable')
  assert.match(result.report().error, /exit status 1/)
})
