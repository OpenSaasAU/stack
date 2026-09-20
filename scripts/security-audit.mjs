import { spawnSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'

const registry = 'https://registry.npmjs.org'
const result = spawnSync('pnpm', ['audit', '--json', `--registry=${registry}`], {
  encoding: 'utf8',
  timeout: 120_000,
  maxBuffer: 20 * 1024 * 1024,
  env: { ...process.env, npm_config_fetch_retries: '2', npm_config_fetch_timeout: '20000' },
})
let audit
let error
try {
  audit = JSON.parse(result.stdout)
} catch {
  error = 'pnpm did not return a JSON audit report.'
}
const counts = audit?.metadata?.vulnerabilities
if (
  !error &&
  !audit?.error &&
  !['info', 'low', 'moderate', 'high', 'critical'].every(
    (severity) => Number.isInteger(counts?.[severity]) && counts[severity] >= 0,
  )
)
  error = 'pnpm returned an incomplete vulnerability report.'
const vulnerable = Boolean(counts) && Object.values(counts).some((count) => count > 0)
if (result.error) error = result.error.message
else if (result.signal || (result.status !== 0 && !(result.status === 1 && vulnerable))) {
  error = `pnpm audit failed with exit status ${result.status}${result.signal ? ` (${result.signal})` : ''}.`
}
const unavailable = Boolean(error || audit?.error)
const status = unavailable ? 'unavailable' : vulnerable ? 'vulnerable' : 'pass'
const message = unavailable
  ? 'Security advisory audit: UNAVAILABLE — release blocked; see security-audit.json and specs/release-security-audit.md.'
  : vulnerable
    ? `Security advisory audit: FAIL — ${Object.entries(counts)
        .map(([severity, count]) => `${count} ${severity}`)
        .join(', ')}. See security-audit.json.`
    : 'Security advisory audit: PASS — no known vulnerabilities.'
writeFileSync(
  'security-audit.json',
  JSON.stringify({ status, registry, audit, error }, null, 2) + '\n',
)
console.log(message)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + '\n')
process.exitCode = unavailable ? 2 : vulnerable ? 1 : 0
