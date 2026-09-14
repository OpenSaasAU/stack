import * as fs from 'fs'
import * as path from 'path'
import { z } from 'zod'
import { OPENSAAS_FILES, runPrismaCli, STAGED_ROOT_PRISMA_CONFIG } from '../generator/index.js'
import type { ResolvedWritePaths } from '../generator/index.js'

/** Where a staged generation lives, inside the Generated bundle. */
export const STAGING_DIR = path.join('.opensaas', 'staged')

/** One operation `prisma db update` planned. */
export interface PlannedOperation {
  readonly label: string
  readonly operationClass: string
}

/** What one `db update` run planned. */
export interface ReconcilePlan {
  readonly operations: readonly PlannedOperation[]
  /** SQL the CLI previewed, present on a `--dry-run`. */
  readonly statements: readonly string[]
  readonly destructive: boolean
}

/** A `db update` run that failed, carrying the CLI's own words. */
export interface ReconcileFailure {
  readonly exitCode: number | null
  readonly output: string
}

export type ReconcileOutcome =
  | { readonly ok: true; readonly plan: ReconcilePlan }
  | { readonly ok: false; readonly failure: ReconcileFailure }

const operationSchema = z.object({
  label: z.string(),
  operationClass: z.string(),
})

const resultEnvelopeSchema = z.object({
  kind: z.literal('result'),
  envelope: z.object({
    result: z.object({
      plan: z
        .object({
          operations: z.array(operationSchema).optional(),
          preview: z
            .object({ statements: z.array(z.object({ text: z.string() })).optional() })
            .optional(),
        })
        .optional(),
    }),
  }),
})

/**
 * The plan out of a `--json` run. The CLI streams newline-delimited progress
 * envelopes and closes with the result one, so the last parseable `result`
 * line is the answer; anything the CLI wrote to stderr is not searched, which
 * is why only stdout is read here.
 */
function readPlan(stdout: string): ReconcilePlan | undefined {
  let plan: ReconcilePlan | undefined
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || !trimmed.startsWith('{')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const envelope = resultEnvelopeSchema.safeParse(parsed)
    if (!envelope.success) continue
    const operations = envelope.data.envelope.result.plan?.operations ?? []
    plan = {
      operations,
      statements: (envelope.data.envelope.result.plan?.preview?.statements ?? []).map(
        (statement) => statement.text,
      ),
      destructive: operations.some((operation) => operation.operationClass === 'destructive'),
    }
  }
  return plan
}

/**
 * Run `prisma db update` against a staged generation and report what it
 * planned.
 *
 * @param configPath - The staged Prisma config, which names the staged
 *   Contract module and the project's own migrations directory.
 * @param options.dryRun - Plan without applying, which is how a destructive
 *   change is discovered before anything is promoted.
 * @param options.confirm - Consent tokens passed straight through to Prisma's
 *   `--confirm`; the Dev database's is its database name, `postgres`.
 */
export async function planDatabaseUpdate(
  cwd: string,
  configPath: string,
  options: { dryRun?: boolean; confirm?: readonly string[] } = {},
): Promise<ReconcileOutcome> {
  const args = ['db', 'update', '--config', configPath, '--json', '--no-interactive']
  if (options.dryRun === true) args.push('--dry-run')
  for (const token of options.confirm ?? []) args.push('--confirm', token)

  const run = await runPrismaCli(cwd, args)
  if (run.exitCode !== 0)
    return { ok: false, failure: { exitCode: run.exitCode, output: run.output } }

  const plan = readPlan(run.stdout)
  if (plan === undefined) {
    return { ok: false, failure: { exitCode: run.exitCode, output: run.output } }
  }
  return { ok: true, plan }
}

/** A `refs/*.json` file and the bytes it held before the loop planned anything. */
interface RefSnapshot {
  readonly file: string
  readonly contents: string
}

/**
 * The migrations graph's named refs, as they stand.
 *
 * The loop owns these: `db update` advances the `db` ref to the contract it
 * just reached, so a plan the loop discards has to leave the refs where it
 * found them — otherwise the discarded schema's ref shadows the source
 * contract on the next plan (ADR-0063).
 */
export function snapshotMigrationRefs(cwd: string): readonly RefSnapshot[] {
  const migrationsDir = path.join(cwd, 'migrations')
  if (!fs.existsSync(migrationsDir)) return []

  const snapshots: RefSnapshot[] = []
  for (const space of fs.readdirSync(migrationsDir, { withFileTypes: true })) {
    if (!space.isDirectory()) continue
    const refsDir = path.join(migrationsDir, space.name, 'refs')
    if (!fs.existsSync(refsDir)) continue
    for (const entry of fs.readdirSync(refsDir)) {
      const file = path.join(refsDir, entry)
      snapshots.push({ file, contents: fs.readFileSync(file, 'utf-8') })
    }
  }
  return snapshots
}

/** The space directory a `refs/*.json` path belongs to. */
function spaceOf(file: string): string {
  return path.basename(path.dirname(path.dirname(file)))
}

/**
 * Puts every snapshotted ref back, and removes any extra ref the run
 * introduced into a space the snapshot already knew about.
 *
 * A space with no snapshotted ref at all was seeded by this run's own
 * `generate` — a newly declared pack reaching `migrations/` for the first
 * time — and is left untouched. That ref is not a discarded run's leftover;
 * it is the new space's only record of itself, and deleting it strands the
 * migration package `seedExtensionContractSpaces` just wrote refless (#1226).
 *
 * "No snapshotted ref" is a proxy for "space didn't exist yet," not a
 * directly-checked fact: a space that existed before this run but already had
 * no ref (already broken, by some other cause) reads the same way, and this
 * run's own ref for it survives the prune too. That is no worse than the
 * space already being broken.
 */
export function restoreMigrationRefs(cwd: string, snapshots: readonly RefSnapshot[]): void {
  const known = new Set(snapshots.map((snapshot) => snapshot.file))
  const knownSpaces = new Set(snapshots.map((snapshot) => spaceOf(snapshot.file)))
  for (const snapshot of snapshotMigrationRefs(cwd)) {
    if (known.has(snapshot.file)) continue
    if (!knownSpaces.has(spaceOf(snapshot.file))) continue
    fs.rmSync(snapshot.file, { force: true })
  }
  for (const snapshot of snapshots) {
    fs.mkdirSync(path.dirname(snapshot.file), { recursive: true })
    fs.writeFileSync(snapshot.file, snapshot.contents, 'utf-8')
  }
}

/** Thrown when promotion stopped part-way, leaving the live bundle split. */
export class PartialPromotionError extends Error {
  /** The live files that already carry the staged generation. */
  readonly promoted: readonly string[]
  /** The live file the failure stopped on, still carrying the previous generation. */
  readonly failedOn: string

  constructor(promoted: readonly string[], failedOn: string, cause: unknown) {
    super(
      `The database was updated, but promoting the staged generation stopped at ${failedOn}. ` +
        `${promoted.length} file(s) already carry the new contract, so the project is split ` +
        'across two contracts. Re-run `opensaas generate` to rewrite the whole bundle from ' +
        `the current config. Underlying failure: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
    this.name = 'PartialPromotionError'
    this.promoted = promoted
    this.failedOn = failedOn
  }
}

/**
 * Copies through a sibling temp name and renames into place, so the app's dev
 * server never reads a half-written file: a rename within one filesystem is
 * atomic, a `copyFileSync` onto a watched path is not.
 */
function swapIntoPlace(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  const staging = `${to}.promoting-${process.pid}`
  try {
    fs.copyFileSync(from, staging)
    fs.renameSync(staging, to)
  } catch (error) {
    fs.rmSync(staging, { force: true })
    throw error
  }
}

/**
 * Move a staged generation into the places the app reads: the Contract module
 * and its emitted artifacts, then the whole bundle directory — enumerating the
 * bundle would strand the extra files a plugin's `afterGenerate` writes there.
 * Called only once the database carries the schema they describe.
 *
 * Each file lands atomically. The set of them does not: the filesystem offers
 * no multi-file commit, and a mid-promotion reader from another process can
 * observe a mix of old and new artifacts (ADR-0072). This order is a stated,
 * not incidental, response to that:
 *
 * - `tables.ts` is derived from the same computation as the Contract module
 *   (ADR-0051), so it lands immediately after the contract artifacts rather
 *   than wherever the bundle directory's unordered `readdirSync` happens to
 *   place it — narrowing, not closing, the window in which the two could
 *   disagree.
 * - `prisma.config.ts` lands **last**, so its landing is the one signal that
 *   the whole set is in place — the ordering an outside observer's own
 *   end-of-promotion signal (a log line printed after this function returns,
 *   for instance) can rely on without inspecting anything else.
 *
 * A failure part-way through throws {@link PartialPromotionError} naming the
 * split rather than a bare copy error.
 *
 * @throws {PartialPromotionError} when promotion stops after the first file.
 */
export function promoteStagedGeneration(
  staged: ResolvedWritePaths,
  live: ResolvedWritePaths,
  stagingDir: string,
): void {
  const moves: [string, string][] = [
    [staged.contractModule, live.contractModule],
    [staged.contractJson, live.contractJson],
    [staged.contractTypes, live.contractTypes],
    [staged.tables, live.tables],
  ]

  if (fs.existsSync(staged.opensaasDir)) {
    for (const entry of fs.readdirSync(staged.opensaasDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === OPENSAAS_FILES.tables) continue
      moves.push([
        path.join(staged.opensaasDir, entry.name),
        path.join(live.opensaasDir, entry.name),
      ])
    }
  }

  const rootPrismaConfig = path.join(stagingDir, STAGED_ROOT_PRISMA_CONFIG)
  if (fs.existsSync(rootPrismaConfig)) moves.push([rootPrismaConfig, live.prismaConfig])

  const promoted: string[] = []
  for (const [from, to] of moves) {
    if (!fs.existsSync(from)) continue
    try {
      swapIntoPlace(from, to)
    } catch (error) {
      if (promoted.length === 0) throw error
      throw new PartialPromotionError(promoted, to, error)
    }
    promoted.push(to)
  }

  fs.rmSync(stagingDir, { recursive: true, force: true })
}

/** Formats a plan the way the loop reports one that it is not applying. */
export function describePlan(plan: ReconcilePlan): string[] {
  const lines = plan.operations.map(
    (operation) => `  • ${operation.label} (${operation.operationClass})`,
  )
  for (const statement of plan.statements) lines.push(`    ${statement}`)
  return lines
}
