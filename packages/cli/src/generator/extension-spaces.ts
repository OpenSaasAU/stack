import * as fs from 'fs'
import * as path from 'path'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import { runContractSpaceSeedPhase } from '@prisma/orm-toolchain/cli/control-api'
import type { ContractSpaceSeedPhaseInputs } from '@prisma/orm-toolchain/cli/control-api'
import type { ContractData } from '@opensaas/stack-core'

// The toolchain declares the per-extension descriptor inline and exports only
// the enclosing inputs type, so the element type is projected out of it.
type SeedPhaseExtensionInput = ContractSpaceSeedPhaseInputs['extensions'][number]

/** The subpaths one `db.extensions` entry must publish, one per emission (ADR-0065). */
const REQUIRED_SUBPATHS = ['pack', 'control', 'runtime'] as const

/**
 * Thrown when a declared extension pack does not publish one of the three
 * subpaths the emissions need. Names the pack and the exact missing subpath —
 * Supabase's pack has no `/control` and is precisely this error.
 */
export class ExtensionSubpathError extends Error {
  constructor(
    /** The pack's binding name, as `db.extensions` spells it. */
    readonly pack: string,
    /** The subpath that did not resolve, e.g. `@prisma/orm-extension-x/control`. */
    readonly subpath: string,
  ) {
    super(
      `Extension pack "${pack}" does not publish "${subpath}". A declared pack must export ` +
        `/pack (the Contract module), /control (prisma.config.ts and the migration seed) and ` +
        `/runtime (the generated client) — ADR-0065. Check the package is installed and that ` +
        `its "exports" map carries that subpath.`,
    )
    this.name = 'ExtensionSubpathError'
  }
}

/**
 * Thrown when a declared pack's `/control` subpath resolves and loads but does
 * not default-export a control descriptor. Names the pack and the subpath, so
 * a pack built against a different toolchain generation is reported as such
 * rather than as a `TypeError` from inside the seed phase.
 */
export class ExtensionDescriptorError extends Error {
  constructor(
    /** The pack's binding name, as `db.extensions` spells it. */
    readonly pack: string,
    /** The subpath that loaded without a usable descriptor. */
    readonly subpath: string,
  ) {
    super(
      `Extension pack "${pack}" exports no control descriptor from "${subpath}". The /control ` +
        `subpath must default-export the pack's control descriptor — an object carrying a string ` +
        `"id" (ADR-0065). Check the installed pack version matches the toolchain this project ` +
        `generates against.`,
    )
    this.name = 'ExtensionDescriptorError'
  }
}

/** One pack's seeded contract space, as the toolchain reported it. */
export interface SeededExtensionSpace {
  /** The pack's binding name from `db.extensions`. */
  pack: string
  /** The toolchain's space id — the directory under `migrations/`. */
  spaceId: string
  /** `updated` when the head ref moved or a package was materialised. */
  action: 'updated' | 'unchanged'
  /** Migration packages written by this call; empty when nothing was missing. */
  migrationDirs: readonly string[]
}

/** What {@link seedExtensionContractSpaces} did, for the generator to report. */
export interface SeededExtensionSpaces {
  /** One record per declared pack, ordered by the toolchain's own space sort. */
  seeded: SeededExtensionSpace[]
}

// The conditions Node applies to `import`, which is how the generated
// prisma.config.ts and Contract module reach these same subpaths. Resolving
// under the `require` conditions instead refuses an ESM-only pack whose
// `exports` map is correct, and picks the CJS half of a dual publish.
const IMPORT_CONDITIONS = new Set(['node', 'import', 'default'])

/** The package directory a bare specifier names, found by Node's own walk. */
function findPackageRoot(cwd: string, from: string): string | undefined {
  const require = createRequire(path.join(cwd, 'noop.js'))
  for (const dir of require.resolve.paths(from) ?? []) {
    const root = path.join(dir, from)
    if (fs.existsSync(path.join(root, 'package.json'))) return root
  }
  return undefined
}

function readExportsField(root: string): unknown {
  let manifest: unknown
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))
  } catch {
    return undefined
  }
  if (typeof manifest !== 'object' || manifest === null || !('exports' in manifest))
    return undefined
  return manifest.exports
}

/** Pick the first target an import-condition matches, substituting a pattern's `*`. */
function selectTarget(target: unknown, star: string | undefined): string | undefined {
  if (typeof target === 'string') {
    return star === undefined ? target : target.replaceAll('*', star)
  }
  if (Array.isArray(target)) {
    for (const entry of target) {
      const picked = selectTarget(entry, star)
      if (picked !== undefined) return picked
    }
    return undefined
  }
  if (typeof target === 'object' && target !== null) {
    for (const [condition, value] of Object.entries(target)) {
      if (!IMPORT_CONDITIONS.has(condition)) continue
      const picked = selectTarget(value, star)
      if (picked !== undefined) return picked
    }
  }
  return undefined
}

function matchSubpath(
  exportsField: unknown,
  key: string,
): { target: unknown; star: string | undefined } | undefined {
  if (typeof exportsField !== 'object' || exportsField === null || Array.isArray(exportsField)) {
    return undefined
  }
  const entries = Object.entries(exportsField)
  if (!entries.some(([name]) => name.startsWith('.'))) return undefined

  for (const [name, target] of entries) {
    if (name === key) return { target, star: undefined }
  }

  let best: { target: unknown; star: string; prefix: string } | undefined
  for (const [name, target] of entries) {
    const starAt = name.indexOf('*')
    if (starAt === -1) continue
    const prefix = name.slice(0, starAt)
    const suffix = name.slice(starAt + 1)
    if (suffix.includes('*')) continue
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue
    if (key.length < prefix.length + suffix.length) continue
    if (best !== undefined && prefix.length <= best.prefix.length) continue
    best = { target, star: key.slice(prefix.length, key.length - suffix.length), prefix }
  }
  return best === undefined ? undefined : { target: best.target, star: best.star }
}

/** The URL `import('<from>/<subpath>')` would load from `cwd`, or undefined. */
function resolveImportSubpath(cwd: string, from: string, subpath: string): string | undefined {
  const root = findPackageRoot(cwd, from)
  if (root === undefined) return undefined

  const exportsField = readExportsField(root)
  let file: string
  if (exportsField === undefined) {
    file = path.join(root, subpath)
  } else {
    const matched = matchSubpath(exportsField, `./${subpath}`)
    if (matched === undefined) return undefined
    const target = selectTarget(matched.target, matched.star)
    if (target === undefined || !target.startsWith('./')) return undefined
    file = path.join(root, target)
  }
  return fs.existsSync(file) ? pathToFileURL(file).href : undefined
}

/**
 * Resolve every required subpath of a declared pack against the project.
 *
 * @returns the URL of the `/control` module, which the seeder then imports —
 *   the check and the load are the one resolution, so they cannot disagree.
 * @throws {ExtensionSubpathError} naming the pack and the first missing subpath.
 */
function resolveSubpaths(cwd: string, pack: string, from: string): { control: string } {
  const resolved: Record<string, string> = {}

  for (const subpath of REQUIRED_SUBPATHS) {
    const url = resolveImportSubpath(cwd, from, subpath)
    if (url === undefined) throw new ExtensionSubpathError(pack, `${from}/${subpath}`)
    resolved[subpath] = url
  }

  return { control: resolved.control }
}

// Only the descriptor's identity is checked. `contractSpace` is optional and
// the seed phase validates its own shape, reporting the pack by id; what it
// cannot report is a missing descriptor, because there is no id to name.
function isControlDescriptor(value: unknown): value is SeedPhaseExtensionInput {
  return (
    typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string'
  )
}

function readControlDescriptor(
  namespace: unknown,
  pack: string,
  subpath: string,
): SeedPhaseExtensionInput {
  if (typeof namespace !== 'object' || namespace === null || !('default' in namespace)) {
    throw new ExtensionDescriptorError(pack, subpath)
  }
  if (!isControlDescriptor(namespace.default)) {
    throw new ExtensionDescriptorError(pack, subpath)
  }
  return namespace.default
}

/**
 * Refuse a declared pack that does not publish every required subpath.
 *
 * Runs before the generator writes `prisma.config.ts` and the Contract module,
 * both of which import `<from>/control` and `<from>/pack`: refusing after the
 * writes would leave the project carrying an unresolvable import.
 *
 * @throws {ExtensionSubpathError} when a declared pack lacks a required subpath.
 */
export function verifyExtensionSubpaths(cwd: string, data: ContractData): void {
  for (const extension of data.extensions) {
    resolveSubpaths(cwd, extension.name, extension.from)
  }
}

/**
 * Materialise each declared extension pack's **Extension contract space**
 * under the project's `migrations/` directory, between writing the Contract
 * module and shelling to `prisma contract emit` (ADR-0065).
 *
 * For every entry in `data.extensions` this derives the `/pack`, `/control`
 * and `/runtime` subpaths from the package name, refuses when one is absent,
 * then hands the `/control` descriptors to the toolchain's public seed phase.
 * That writes five files per pack — the migration package's `migration.json`
 * and `ops.json`, `refs/head.json`, and the space's `contract.json` +
 * `contract.d.ts` in the content-addressed snapshot store.
 *
 * The space's content is a function of the installed pack version alone, so
 * the files are committed and regenerated on every `generate`: a pack upgrade
 * shipping a new package shows up as a generate diff, and `db update` never
 * meets a declared-but-unmigrated space.
 *
 * Seeding opens no database connection — it is a file copy out of the pack's
 * own descriptor.
 *
 * Known limits:
 * - The migrations directory is the toolchain's default, `<cwd>/migrations`.
 *   A project that overrides `migrations.dir` in a hand-edited
 *   `prisma.config.ts` would be seeded in the wrong place; the generated
 *   config never sets that key.
 * - Only the `/control` subpath is loaded. `/pack` and `/runtime` are checked
 *   for resolvability and are otherwise the Contract module's and the
 *   generated client's business.
 * - A pack whose `/control` descriptor ships no `contractSpace` is resolved
 *   and passed through; the toolchain reports nothing seeded for it.
 * - Only the grow direction is tracked. Dropping a pack from `db.extensions`
 *   rewrites the other emissions but leaves `migrations/<pack>/**` on disk,
 *   and `generate` still exits 0; the toolchain then refuses the next
 *   `db init`/`db update` with `orphanSpaceDir`. Remove the directory by hand
 *   until https://github.com/OpenSaasAU/stack/issues/1192 lands.
 * - Subpaths are resolved by reading the pack's `exports` under the `import`
 *   condition, which is how the generated artifacts reach them. Exotic maps
 *   (nested patterns, `imports`-style self-reference) are not covered.
 *
 * @param cwd - The project root, which is also the migrations directory's parent.
 * @param data - The derived contract, read only for its declared extensions.
 * @throws {ExtensionSubpathError} when a declared pack lacks a required subpath.
 * @throws {ExtensionDescriptorError} when `/control` has no default descriptor.
 *
 * @example
 * ```typescript
 * const { seeded } = await seedExtensionContractSpaces(cwd, deriveContract(config))
 * // → [{ pack: 'pgvector', spaceId: 'pgvector', action: 'unchanged', migrationDirs: [] }]
 * ```
 */
export async function seedExtensionContractSpaces(
  cwd: string,
  data: ContractData,
): Promise<SeededExtensionSpaces> {
  if (data.extensions.length === 0) return { seeded: [] }

  const descriptors: SeedPhaseExtensionInput[] = []
  const packBySpaceId = new Map<string, string>()

  for (const extension of data.extensions) {
    const { control } = resolveSubpaths(cwd, extension.name, extension.from)
    const namespace: unknown = await import(control)
    const descriptor = readControlDescriptor(namespace, extension.name, `${extension.from}/control`)
    descriptors.push(descriptor)
    packBySpaceId.set(descriptor.id, extension.name)
  }

  const result = await runContractSpaceSeedPhase({
    migrationsDir: path.join(cwd, 'migrations'),
    extensions: descriptors,
  })

  return {
    seeded: result.seeded.map((record) => ({
      pack: packBySpaceId.get(record.spaceId) ?? record.spaceId,
      spaceId: record.spaceId,
      action: record.action,
      migrationDirs: record.newMigrationDirs,
    })),
  }
}
