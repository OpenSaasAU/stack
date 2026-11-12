import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import { runPrismaCli } from '../generator/prisma-cli.js'

interface Edge {
  dir: string
  from: string
  to: string
  createdAt: number | null
}

/** Thrown when two migration packages leave the same state for different ones. */
export class MultipleMigrationHeadsError extends Error {
  constructor(readonly candidates: readonly Edge[]) {
    super(
      'The app migration graph forks: ' +
        candidates.map((edge) => `${edge.dir} (${edge.from} -> ${edge.to})`).join(', ') +
        '. Merge or remove the divergent migration packages, or pass --from <hash> ' +
        `to choose an origin, e.g. --from ${candidates[0]?.to ?? '<hash>'}.`,
    )
    this.name = 'MultipleMigrationHeadsError'
  }
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
    const field = (key: string): unknown =>
      typeof manifest === 'object' && manifest !== null && key in manifest
        ? Object.getOwnPropertyDescriptor(manifest, key)?.value
        : undefined
    const from = field('from')
    const to = field('to')
    const created = field('createdAt')
    if (typeof to !== 'string') throw new Error(`${file} has no string "to" hash.`)
    const parsed = typeof created === 'string' ? Date.parse(created) : NaN
    edges.push({
      dir: entry.name,
      from: typeof from === 'string' ? from : '',
      to,
      createdAt: Number.isNaN(parsed) ? null : parsed,
    })
  }
  return edges.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0))
}

function headByTimestamp(edges: readonly Edge[]): string {
  const ordered = [...edges].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  const last = ordered[ordered.length - 1]!
  const forks = ordered.filter(
    (edge, index) =>
      edge !== last &&
      edge.from === last.from &&
      edge.to !== last.to &&
      !ordered.slice(index + 1).some((later) => later.from === edge.to),
  )
  if (forks.length > 0) throw new MultipleMigrationHeadsError([...forks, last])
  return last.to
}

function headByChain(edges: readonly Edge[]): string {
  const targets = new Set(edges.map((edge) => edge.to))
  const roots = [...new Set(edges.map((edge) => edge.from))].filter((from) => !targets.has(from))
  const root = roots[0]
  if (root === undefined || roots.length > 1) {
    const latest = edges[edges.length - 1]!
    throw new Error(
      `The app migration graph has no single origin (${edges.length} packages, no usable createdAt). ` +
        `Pass --from <hash> to choose an origin, e.g. --from ${latest.to}.`,
    )
  }
  const used = new Set<Edge>()
  let current = root
  for (;;) {
    const next = edges.filter((edge) => edge.from === current && !used.has(edge))
    if (next.length === 0) return current
    const distinct = new Set(next.map((edge) => edge.to))
    if (distinct.size > 1) throw new MultipleMigrationHeadsError(next)
    used.add(next[0]!)
    current = next[0]!.to
  }
}

/**
 * The state the most recently planned migration package leaves, or `null` when
 * the app space has no package yet. Packages are ordered by their manifest's
 * `createdAt`; without one on every package the chain is walked from the baseline.
 *
 * @throws {MultipleMigrationHeadsError} when two packages fork the graph.
 */
export function resolveMigrationHead(cwd: string): string | null {
  const edges = readEdges(path.join(cwd, 'migrations', 'app'))
  if (edges.length === 0) return null
  return edges.every((edge) => edge.createdAt !== null)
    ? headByTimestamp(edges)
    : headByChain(edges)
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
