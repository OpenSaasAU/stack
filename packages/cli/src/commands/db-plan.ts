import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import { runPrismaCli } from '../generator/prisma-cli.js'

/** Thrown when the app migration graph has more than one head. */
export class MultipleMigrationHeadsError extends Error {
  constructor(readonly heads: readonly string[]) {
    super(
      `The app migration graph has ${heads.length} heads: ${heads.join(', ')}. ` +
        'Merge or remove the divergent migration packages, or pass --from <hash> to choose one.',
    )
    this.name = 'MultipleMigrationHeadsError'
  }
}

interface Edge {
  from: string
  to: string
}

function readEdges(appDir: string): Edge[] {
  if (!fs.existsSync(appDir)) return []
  const edges: Edge[] = []
  for (const entry of fs.readdirSync(appDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = path.join(appDir, entry.name, 'migration.json')
    if (!fs.existsSync(file)) continue
    let manifest: unknown
    try {
      manifest = JSON.parse(fs.readFileSync(file, 'utf-8'))
    } catch (error) {
      throw new Error(`Could not read ${file}: ${error instanceof Error ? error.message : error}`)
    }
    const from =
      typeof manifest === 'object' && manifest !== null && 'from' in manifest
        ? manifest.from
        : undefined
    const to =
      typeof manifest === 'object' && manifest !== null && 'to' in manifest
        ? manifest.to
        : undefined
    if (typeof to !== 'string') throw new Error(`${file} has no string "to" hash.`)
    edges.push({ from: typeof from === 'string' ? from : '', to })
  }
  return edges
}

/**
 * The hash no migration package leaves from, or `null` when the app space has
 * no package yet.
 *
 * @throws {MultipleMigrationHeadsError} when more than one hash qualifies.
 */
export function resolveMigrationHead(cwd: string): string | null {
  const edges = readEdges(path.join(cwd, 'migrations', 'app'))
  if (edges.length === 0) return null
  const origins = new Set(edges.map((edge) => edge.from))
  const heads = [...new Set(edges.map((edge) => edge.to))].filter((to) => !origins.has(to))
  if (heads.length > 1) throw new MultipleMigrationHeadsError(heads)
  const head = heads[0]
  if (head === undefined)
    throw new Error(
      'The app migration graph has no head (its packages form a cycle). Pass --from <hash> to choose an origin.',
    )
  return head
}

/** The `prisma migration plan` arguments for the given forwarded arguments. */
export function buildPlanArgs(cwd: string, forwarded: readonly string[]): string[] {
  const separator = forwarded.indexOf('--')
  const flags = separator === -1 ? forwarded : forwarded.slice(0, separator)
  const named = flags.some((arg) => arg === '--from' || arg.startsWith('--from='))
  const head = named ? null : resolveMigrationHead(cwd)
  return ['migration', 'plan', ...(head === null ? [] : ['--from', head]), ...forwarded]
}

/**
 * `opensaas db plan` — plans a migration package from the head of the app
 * migration graph, so the committed `db` ref never decides the origin.
 */
export async function dbPlanCommand(forwarded: readonly string[] = []): Promise<void> {
  const cwd = process.cwd()
  try {
    const run = await runPrismaCli(cwd, buildPlanArgs(cwd, forwarded), 'interactive')
    if (run.exitCode !== 0) process.exitCode = run.exitCode ?? 1
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)))
    process.exitCode = 1
  }
}
