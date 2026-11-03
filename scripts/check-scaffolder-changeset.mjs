import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SCAFFOLDER = 'create-opensaas-app'
const directory = process.argv[2] ?? '.changeset'

function bumpedPackages(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)
  if (match === null) return []
  const names = []
  for (const line of match[1].split(/\r?\n/)) {
    const entry = /^\s*['"]?([^'":\s]+)['"]?\s*:\s*(major|minor|patch)\s*$/.exec(line)
    if (entry !== null) names.push(entry[1])
  }
  return names
}

const bumped = readdirSync(directory)
  .filter((file) => file.endsWith('.md') && file !== 'README.md')
  .flatMap((file) => bumpedPackages(readFileSync(join(directory, file), 'utf8')))

const triggers = [
  ...new Set(
    bumped.filter(
      (name) => name.startsWith('@opensaas/stack-') || /^opensaas-starter.*-example$/.test(name),
    ),
  ),
]

if (triggers.length > 0 && !bumped.includes(SCAFFOLDER)) {
  console.error(
    `Pending changesets bump ${triggers.join(', ')} but none names ${SCAFFOLDER}.\n` +
      `Add a patch changeset for ${SCAFFOLDER} so the published scaffolder tracks the stack:\n\n` +
      `---\n'${SCAFFOLDER}': patch\n---\n\nRefresh templates for the latest stack release.\n`,
  )
  process.exit(1)
}
