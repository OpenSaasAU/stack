#!/usr/bin/env node
// Fails when a doc states a Node.js version below the engines floor.
// Usage: pnpm check:doc-node-version
// Known limits: only "Node" / "Node.js" followed by `N+` or `vN` is read.

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..')
const floor = JSON.parse(
  readFileSync(path.join(repoRoot, 'packages/cli/package.json'), 'utf8'),
).engines.node.replace(/^[^\d]*/, '')
const floorParts = floor.split('.').map(Number)

function* markdownFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'CHANGELOG.md' ||
      entry.name.startsWith('.')
    )
      continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* markdownFiles(full)
    else if (/\.mdx?$/.test(entry.name)) yield full
  }
}

export function belowFloor(line) {
  const found = []
  for (const m of line.matchAll(/\bNode(?:\.js)?\s+v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/gi)) {
    const have = [m[1], m[2] ?? 0, m[3] ?? 0].map(Number)
    for (let i = 0; i < 3; i++) {
      if (have[i] > floorParts[i]) break
      if (have[i] < floorParts[i]) {
        found.push(m[0])
        break
      }
    }
  }
  return found
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const failures = []
  for (const root of ['README.md', 'CONTRIBUTING.md', 'docs/content', 'packages', 'examples']) {
    const full = path.join(repoRoot, root)
    const files = root.endsWith('.md') ? [full] : [...markdownFiles(full)]
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const hit of belowFloor(line))
            failures.push(
              `${path.relative(repoRoot, file)}:${i + 1}: "${hit}" is below Node ${floor}`,
            )
        })
    }
  }
  if (failures.length) {
    console.error(failures.join('\n'))
    process.exit(1)
  }
}
