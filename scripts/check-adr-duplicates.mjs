#!/usr/bin/env node
// Fails when docs/adr/ contains two files sharing the same leading NNNN
// number. Gaps in the sequence (withdrawn/superseded records) are fine —
// only a number claimed by more than one file is a defect. See ADR-0043
// and issue #1105.

import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const adrDir = path.resolve(fileURLToPath(import.meta.url), '../../docs/adr')

const byNumber = new Map()
for (const filename of readdirSync(adrDir)) {
  const match = filename.match(/^(\d+)-/)
  if (!match) continue
  const number = match[1]
  const files = byNumber.get(number) ?? []
  files.push(filename)
  byNumber.set(number, files)
}

const duplicates = [...byNumber.entries()].filter(([, files]) => files.length > 1)

if (duplicates.length > 0) {
  console.error('Duplicate ADR numbers found in docs/adr/:\n')
  for (const [number, files] of duplicates) {
    console.error(`  ${number}:`)
    for (const file of files) console.error(`    - ${file}`)
  }
  console.error(
    '\nEach ADR number must be claimed by exactly one file. Renumber one of the files above.',
  )
  process.exit(1)
}

console.log(`No duplicate ADR numbers found (${byNumber.size} numbers checked).`)
