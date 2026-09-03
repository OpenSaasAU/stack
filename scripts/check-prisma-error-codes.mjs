#!/usr/bin/env node
// Fails when a Prisma error-code literal appears outside, or beyond the per-file
// baseline in, scripts/prisma-error-code-allowlist.txt (ADR-0042).

import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..')
const allowlistPath = path.join(repoRoot, 'scripts', 'prisma-error-code-allowlist.txt')
const allowlistRelative = path.relative(repoRoot, allowlistPath)

const literal = /\bP[1-6]\d{3}\b/g
const unscanned = [
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)CHANGELOG\.md$/,
  /^docs\/\.embeddings\//,
  /\.(png|jpe?g|gif|ico|svg|webp|woff2?|ttf|otf|db|pdf)$/i,
]

const allowlist = new Map()
const malformed = []
for (const raw of readFileSync(allowlistPath, 'utf8').split('\n')) {
  const line = raw.trim()
  if (!line || line.startsWith('#')) continue
  const separator = line.lastIndexOf(':')
  const count = separator === -1 ? NaN : Number(line.slice(separator + 1))
  if (separator < 1 || !Number.isInteger(count) || count < 1) {
    malformed.push(line)
    continue
  }
  allowlist.set(line.slice(0, separator), count)
}

if (malformed.length > 0) {
  console.error(`Malformed entries in ${allowlistRelative} (expected path:count):\n`)
  for (const line of malformed) console.error(`  ${line}`)
  process.exit(1)
}

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
    const matches = lines[i].match(literal)
    if (!matches) continue
    const found = hits.get(file) ?? []
    for (const match of matches) found.push(`${i + 1}: ${match}  ${lines[i].trim()}`)
    hits.set(file, found)
  }
}

const unexpected = [...hits.entries()].filter(([file]) => !allowlist.has(file))
const over = []
const under = []
for (const [file, recorded] of allowlist) {
  const actual = hits.get(file)?.length ?? 0
  if (actual > recorded) over.push({ file, recorded, actual })
  else if (actual < recorded) under.push({ file, recorded, actual })
}

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

if (over.length > 0) {
  console.error('Allowlisted files with more Prisma error-code literals than their baseline:\n')
  for (const { file, recorded, actual } of over) {
    console.error(`  ${file}: recorded ${recorded}, found ${actual}`)
    for (const line of hits.get(file)) console.error(`    ${line}`)
  }
  console.error(
    `\nRemove the added literals rather than raising the baseline in ${allowlistRelative}.`,
  )
}

if (under.length > 0) {
  console.error('Allowlist entries whose file now has fewer Prisma error-code literals:\n')
  for (const { file, recorded, actual } of under) {
    console.error(`  ${file}: recorded ${recorded}, found ${actual}`)
  }
  console.error(
    `\nLower or remove these entries in ${allowlistRelative} so the baseline only shrinks.`,
  )
}

if (unexpected.length > 0 || over.length > 0 || under.length > 0) process.exit(1)

const remaining = [...hits.values()].reduce((sum, lines) => sum + lines.length, 0)
console.log(
  `No Prisma error-code literals beyond the allowlist (${files.length} files scanned, ${remaining} literals remain across ${hits.size} allowlisted files).`,
)
