#!/usr/bin/env node
// Fails when an install command in docs/content names `prisma` or an
// `@prisma/*` package without the exact version the workspace pins. See #2000.
//
// Usage: pnpm check:doc-prisma-pins   (--self-test to run the built-in fixtures)
//
// Known limits: only `pnpm|npm|yarn|bun add|install|i` commands are read, and
// only on the line they start (no `\` continuations). `npx`/`dlx` are not.

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..')

function pinned(pkgDir, name) {
  const json = JSON.parse(readFileSync(path.join(repoRoot, pkgDir, 'package.json'), 'utf8'))
  const version = json.devDependencies?.[name] ?? json.dependencies?.[name]
  if (!version) throw new Error(`${pkgDir} does not pin ${name}`)
  return version
}

const pins = {
  prisma: pinned('packages/cli', 'prisma'),
  '@prisma/orm-postgres': pinned('packages/core', '@prisma/orm-postgres'),
  '@prisma/orm-extension-pgvector': pinned('packages/rag', '@prisma/orm-extension-pgvector'),
}

function* markdownFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* markdownFiles(full)
    else if (/\.mdx?$/.test(entry.name)) yield full
  }
}

const installLine = /\b(?:pnpm|npm|yarn|bun)\s+(?:add|install|i)\s+(.*)$/

function unpinnedTokens(line) {
  const match = installLine.exec(line)
  if (!match) return []
  const found = []
  for (const raw of match[1].split(/\s+/)) {
    const token = raw.replace(/^['"]|['";,)]+$/g, '')
    const at = token.lastIndexOf('@')
    const name = at > 0 ? token.slice(0, at) : token
    const version = at > 0 ? token.slice(at + 1) : null
    if (name in pins && version !== pins[name])
      found.push(`${token} should be ${name}@${pins[name]}`)
  }
  return found
}

if (process.argv.includes('--self-test')) {
  const cases = [
    ['pnpm add prisma', 1],
    ['pnpm add -D prisma@8.0.0-rc.22', 0],
    ['cd app && pnpm add @prisma/orm-postgres@latest;', 1],
    ['npm install "prisma"', 1],
    ['pnpm add @opensaas/stack-core', 0],
    ['npx prisma generate', 0],
  ]
  const failed = cases.filter(([line, count]) => unpinnedTokens(line).length !== count)
  if (failed.length > 0) {
    console.error(`self-test failed: ${failed.map(([line]) => line).join(' | ')}`)
    process.exit(1)
  }
  console.log('self-test ok')
  process.exit(0)
}

const findings = []

for (const file of markdownFiles(path.join(repoRoot, 'docs/content'))) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      for (const message of unpinnedTokens(line)) {
        findings.push(`${path.relative(repoRoot, file)}:${index + 1}: ${message}`)
      }
    })
}

if (findings.length > 0) {
  console.error(findings.join('\n'))
  process.exit(1)
}
console.log('doc Prisma install pins ok')
