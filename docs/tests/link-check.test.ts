import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkPageLinks } from '../lib/link-check'

const publicDir = mkdtempSync(join(tmpdir(), 'public-'))
writeFileSync(join(publicDir, 'logo.png'), '')
const pages: Record<string, string> = {
  'a/b': '# B\n\n## Hooks\n\n## Other\n\n## Hooks\n',
}
const env = {
  slugSet: new Set(['a/b', 'a/c']),
  redirects: new Map<string, string>(),
  publicDir,
  getContent: (slug: string) => pages[slug] ?? '',
}
const run = (md: string) => checkPageLinks('a/c', md, env).errors

test('a root-relative link to nothing fails', () => {
  assert.equal(run('[x](/guides/custom-fields)').length, 1)
  assert.equal(run('[x](/no-such-file.png)').length, 1)
})

test('a root-relative link to a public file passes', () => {
  assert.deepEqual(run('[x](/logo.png)'), [])
})

test('a same-page fragment with no heading fails', () => {
  assert.equal(run('# Title\n\n[x](#nope)').length, 1)
  assert.deepEqual(run('# Title\n\n[x](#title)'), [])
})

test('a link to a duplicated id fails, the suffixed id passes', () => {
  assert.equal(run('[x](/docs/a/b#hooks)').length, 1)
  assert.deepEqual(run('[x](/docs/a/b#hooks-1)'), [])
  assert.deepEqual(run('[x](/docs/a/b#other)'), [])
})

test('an explicit id disambiguates a duplicated heading', () => {
  pages['a/b'] = '## Hooks {% #hooks %}\n\n## Hooks\n'
  assert.deepEqual(run('[x](/docs/a/b#hooks)'), [])
})
