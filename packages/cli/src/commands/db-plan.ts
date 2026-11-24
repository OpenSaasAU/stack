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

/** Thrown when two migration packages both claim to be the latest. */
export class MultipleMigrationHeadsError extends Error {
  constructor(readonly candidates: readonly Edge[]) {
    const [newest, ...others] = candidates
    super(
      'The app migration graph forks: ' +
        candidates.map((edge) => `${edge.dir} (${edge.from} -> ${edge.to})`).join(', ') +
        `. Pass --from <hash> to choose an origin, e.g. --from ${newest?.to ?? '<hash>'}` +
        (others.length > 0
          ? `; ${others.map((edge) => edge.dir).join(', ')} must then be removed or joined.`
          : '.'),
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

const byAge = (a: Edge, b: Edge): number =>
  (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0)

interface Walk {
  head: string
  last: Edge
  forked: Edge[] | null
}

function walkChain(edges: readonly Edge[], order: (a: Edge, b: Edge) => number): Walk | null {
  const targets = new Set(edges.map((edge) => edge.to))
  const roots = [...new Set(edges.map((edge) => edge.from))].filter((from) => !targets.has(from))
  const root = roots[0]
  if (root === undefined || roots.length > 1) return null
  const used = new Set<Edge>()
  let current = root
  let last: Edge | null = null
  for (;;) {
    const next = edges.filter((edge) => edge.from === current && !used.has(edge)).sort(order)
    const first = next[0]
    if (first === undefined) return last === null ? null : { head: current, last, forked: null }
    if (new Set(next.map((edge) => edge.to)).size > 1) {
      return { head: current, last: first, forked: next }
    }
    used.add(first)
    last = first
    current = first.to
  }
}

function headByTimestamp(edges: readonly Edge[]): string {
  const ordered = [...edges].sort(byAge)
  const last = ordered[ordered.length - 1]!
  const leaves = ordered.filter(
    (edge, index) =>
      edge !== last &&
      edge.to !== last.to &&
      !ordered.slice(index + 1).some((later) => later.from === edge.to),
  )
  const unresolved = leaves.filter(
    (edge) => !ordered.some((later) => byAge(later, edge) > 0 && later.from !== edge.from),
  )
  if (unresolved.length > 0) {
    throw new MultipleMigrationHeadsError([last, ...unresolved.reverse()])
  }
  for (const edge of leaves) {
    console.warn(
      `Ignoring ${edge.dir}: it leaves ${edge.to}, which no later package builds on. ` +
        `Planning from ${last.dir}.`,
    )
  }
  return last.to
}

function noOrigin(edges: readonly Edge[]): Error {
  const latest = edges[edges.length - 1]!
  return new Error(
    `The app migration graph has no single origin (${edges.length} packages, no usable createdAt). ` +
      `Pass --from <hash> to choose an origin, e.g. --from ${latest.to}.`,
  )
}

function headByChain(edges: readonly Edge[]): string {
  const walk = walkChain(edges, byAge)
  if (walk === null) throw noOrigin(edges)
  if (walk.forked !== null) {
    const newestFirst = [...walk.forked].sort((a, b) => byAge(b, a))
    throw new MultipleMigrationHeadsError(newestFirst)
  }
  console.warn(
    `No createdAt on every package; walked the chain from the baseline and chose ${walk.last.dir} (-> ${walk.head}).`,
  )
  return walk.head
}

/**
 * The state the most recently planned migration package leaves, or `null` when
 * the app space has no package yet. Packages are found by walking the chain from the baseline,
 * with `createdAt` ordering forks. A fork a later package builds past is ignored with a warning.
 *
 * @throws {MultipleMigrationHeadsError} when two packages fork the graph.
 */
export function resolveMigrationHead(cwd: string): string | null {
  const edges = readEdges(path.join(cwd, 'migrations', 'app'))
  if (edges.length === 0) return null
  if (edges.every((edge) => edge.createdAt !== null)) {
    const walk = walkChain(edges, byAge)
    return walk !== null && walk.forked === null ? walk.head : headByTimestamp(edges)
  }
  return headByChain(edges)
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
 * `opensaas db plan` — plans a migration package from the state the latest
 * migration package leaves, so the committed `db` ref never decides the origin.
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
