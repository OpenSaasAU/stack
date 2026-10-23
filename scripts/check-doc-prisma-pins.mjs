#!/usr/bin/env node
// Fails when an install command in docs/content names `prisma` or an
// `@prisma/*` package without the exact version the workspace pins. See #2000.
//
// Known limits: only lines beginning with pnpm/npm/yarn/bun add|install|i are
// read, and only the same line (no `\` continuations).

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

const installLine = /^\s*(?:\$\s*)?(?:pnpm|npm|yarn|bun)\s+(?:add|install|i)\s+(.*)$/
const findings = []

for (const file of markdownFiles(path.join(repoRoot, 'docs/content'))) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const match = installLine.exec(line)
      if (!match) return
      for (const token of match[1].split(/\s+/)) {
        const at = token.lastIndexOf('@')
        const name = at > 0 ? token.slice(0, at) : token
        const version = at > 0 ? token.slice(at + 1) : null
        if (!(name in pins) || version === pins[name]) continue
        findings.push(
          `${path.relative(repoRoot, file)}:${index + 1}: ${token} should be ${name}@${pins[name]}`,
        )
      }
    })
}

if (findings.length > 0) {
  console.error(findings.join('\n'))
  process.exit(1)
}
console.log('doc Prisma install pins ok')
