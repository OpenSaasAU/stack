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
  abandoned: Edge[]
}

function returnsTo(
  edges: readonly Edge[],
  used: ReadonlySet<Edge>,
  via: Edge,
  state: string,
): boolean {
  const seen = new Set<Edge>([via])
  const queue = [via.to]
  while (queue.length > 0) {
    const at = queue.shift()!
    if (at === state) return true
    for (const edge of edges) {
      if (edge.from !== at || used.has(edge) || seen.has(edge)) continue
      seen.add(edge)
      queue.push(edge.to)
    }
  }
  return false
}

function walkChain(edges: readonly Edge[]): Walk | null {
  const targets = new Set(edges.map((edge) => edge.to))
  const roots = [...new Set(edges.map((edge) => edge.from))].filter((from) => !targets.has(from))
  const root = roots[0]
  if (root === undefined || roots.length > 1) return null
  const used = new Set<Edge>()
  const abandoned: Edge[] = []
  let current = root
  let last: Edge | null = null
  for (;;) {
    let next = edges.filter((edge) => edge.from === current && !used.has(edge)).sort(byAge)
    const looping = next.find((edge) => returnsTo(edges, used, edge, current))
    if (looping !== undefined) next = [looping]
    if (new Set(next.map((edge) => edge.to)).size > 1) {
      const continuing = next.filter((edge) =>
        edges.some((other) => other.from === edge.to && !used.has(other)),
      )
      if (new Set(continuing.map((edge) => edge.to)).size !== 1) {
        return { head: current, last: next[0]!, forked: next, abandoned }
      }
      const kept = continuing[0]!.to
      for (const edge of next) {
        if (edge.to === kept) continue
        used.add(edge)
        abandoned.push(edge)
      }
      next = next.filter((edge) => edge.to === kept)
    }
    const first = next[0]
    if (first === undefined) {
      return last === null ? null : { head: current, last, forked: null, abandoned }
    }
    used.add(first)
    last = first
    current = first.to
  }
}

function noOrigin(edges: readonly Edge[]): Error {
  const latest = edges[edges.length - 1]!
  return new Error(
    `The app migration graph has no single origin (${edges.length} packages). ` +
      `Pass --from <hash> to choose an origin, e.g. --from ${latest.to}.`,
  )
}

/**
 * The state the most recently planned migration package leaves, or `null` when
 * the app space has no package yet. Packages are found by walking the chain from the baseline,
 * with `createdAt` ordering packages that leave the same state. A leaf is ignored with a warning once a sibling branch continues past it.
 *
 * @throws {MultipleMigrationHeadsError} when two packages fork the graph.
 */
export function resolveMigrationHead(cwd: string): string | null {
  const edges = readEdges(path.join(cwd, 'migrations', 'app'))
  if (edges.length === 0) return null
  const walk = walkChain(edges)
  if (walk === null) throw noOrigin(edges)
  if (walk.forked !== null) {
    throw new MultipleMigrationHeadsError([...walk.forked].sort((a, b) => byAge(b, a)))
  }
  for (const edge of walk.abandoned) {
    console.warn(
      `Ignoring ${edge.dir}: it leaves ${edge.to}, and a later package builds on a sibling branch. ` +
        `Planning from ${walk.last.dir}.`,
    )
  }
  if (edges.some((edge) => edge.createdAt === null)) {
    console.warn(
      `No createdAt on every package; chose ${walk.last.dir} (-> ${walk.head}) by walking the chain.`,
    )
  }
  return walk.head
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
