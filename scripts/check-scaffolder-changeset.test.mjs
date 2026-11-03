import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const command = fileURLToPath(new URL('./check-scaffolder-changeset.mjs', import.meta.url))

function run(t, changesets) {
  const directory = mkdtempSync(join(tmpdir(), 'scaffolder-changeset-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(join(directory, 'README.md'), '# Changesets\n')
  for (const [name, packages] of Object.entries(changesets)) {
    const frontmatter = packages.map(([pkg, bump]) => `'${pkg}': ${bump}`).join('\n')
    writeFileSync(join(directory, name), `---\n${frontmatter}\n---\n\nChange.\n`)
  }
  return spawnSync(process.execPath, [command, directory], { encoding: 'utf8' })
}

test('fails when only a stack package is bumped', (t) => {
  const result = run(t, { 'a.md': [['@opensaas/stack-core', 'patch']] })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /patch changeset for create-opensaas-app/)
})

test('fails when a starter example is changed without the scaffolder', (t) => {
  const result = run(t, { 'a.md': [['opensaas-starter-auth-example', 'patch']] })
  assert.equal(result.status, 1)
})

test('passes once a create-opensaas-app changeset exists', (t) => {
  const result = run(t, {
    'a.md': [['@opensaas/stack-core', 'patch']],
    'b.md': [['create-opensaas-app', 'patch']],
  })
  assert.equal(result.status, 0)
})

test('passes when no stack package is bumped', (t) => {
  assert.equal(run(t, {}).status, 0)
})
