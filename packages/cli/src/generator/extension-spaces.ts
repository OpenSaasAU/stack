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

/**
 * Resolve every required subpath of a declared pack against the project.
 *
 * @throws {ExtensionSubpathError} naming the pack and the first missing subpath.
 */
function resolveSubpaths(cwd: string, pack: string, from: string): { control: string } {
  const require = createRequire(path.join(cwd, 'noop.js'))
  const resolved: Record<string, string> = {}

  for (const subpath of REQUIRED_SUBPATHS) {
    const specifier = `${from}/${subpath}`
    try {
      resolved[subpath] = require.resolve(specifier)
    } catch {
      throw new ExtensionSubpathError(pack, specifier)
    }
  }

  return { control: resolved.control }
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
 *
 * @param cwd - The project root, which is also the migrations directory's parent.
 * @param data - The derived contract, read only for its declared extensions.
 * @throws {ExtensionSubpathError} when a declared pack lacks a required subpath.
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
    const module: { default: SeedPhaseExtensionInput } = await import(pathToFileURL(control).href)
    const descriptor = module.default
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
