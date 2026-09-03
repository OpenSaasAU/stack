#!/usr/bin/env node
// Fails when any tracked (or untracked, non-ignored) file carries a Prisma
// error-code literal outside scripts/prisma-error-code-allowlist.txt. Prisma 8
// raises no such codes, so a surviving literal is a dead discriminant
// (ADR-0042). The allowlist only shrinks: a hit outside it fails, and so does
// an entry whose file no longer has one. Lockfiles and CHANGELOGs (release
// history the changeset pipeline regenerates) are not scanned.

import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..')
const allowlistPath = path.join(repoRoot, 'scripts', 'prisma-error-code-allowlist.txt')

const literal = /\bP\d{4}\b/
const unscanned = [
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)CHANGELOG\.md$/,
  /\.(png|jpe?g|gif|ico|svg|webp|woff2?|ttf|otf|db|pdf)$/i,
]

const allowlist = new Set(
  readFileSync(allowlistPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')),
)

const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  {
    cwd: repoRoot,
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter((file) => file && !unscanned.some((pattern) => pattern.test(file)))

const hits = new Map()
for (const file of files) {
  const absolute = path.join(repoRoot, file)
  let stat
  try {
    stat = lstatSync(absolute)
  } catch {
    continue
  }
  if (!stat.isFile()) continue
  const text = readFileSync(absolute, 'utf8')
  if (text.includes('\0')) continue
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!literal.test(lines[i])) continue
    const found = hits.get(file) ?? []
    found.push(`${i + 1}: ${lines[i].trim()}`)
    hits.set(file, found)
  }
}

const unexpected = [...hits.entries()].filter(([file]) => !allowlist.has(file))
const stale = [...allowlist].filter((file) => !hits.has(file))

if (unexpected.length > 0) {
  console.error('Prisma error-code literals found outside the allowlist:\n')
  for (const [file, lines] of unexpected) {
    console.error(`  ${file}`)
    for (const line of lines) console.error(`    ${line}`)
  }
  console.error(
    '\nPrisma 8 raises no such codes (ADR-0042). Remove the literal rather than extending the allowlist.',
  )
}

if (stale.length > 0) {
  console.error('Allowlist entries with no remaining Prisma error-code literal:\n')
  for (const file of stale) console.error(`  ${file}`)
  console.error(
    `\nRemove them from ${path.relative(repoRoot, allowlistPath)} so the list keeps shrinking.`,
  )
}

if (unexpected.length > 0 || stale.length > 0) process.exit(1)

console.log(
  `No Prisma error-code literals outside the allowlist (${files.length} files scanned, ${hits.size} allowlisted files still carry one).`,
)
