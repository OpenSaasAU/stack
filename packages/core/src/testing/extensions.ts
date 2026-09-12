import type { PostgresControlClientOptions } from '@prisma/orm-postgres/control'
import type { PostgresOptionsBase } from '@prisma/orm-postgres/runtime'
import type { ExtensionDescriptor } from '../config/types.js'
import type { PrismaContractPacks } from '../contract/prisma.js'

/** The `/control` descriptor: what the seed phase and the control client take. */
export type ExtensionControlDescriptor = NonNullable<
  PostgresControlClientOptions['extensions']
>[number]

/** The `/runtime` descriptor: what `postgres({ extensions })` takes. */
export type ExtensionRuntimeDescriptor = NonNullable<PostgresOptionsBase['extensions']>[number]

/** The `/pack` descriptor: what the contract builder takes. */
export type ExtensionPackDescriptor = PrismaContractPacks[string]

/** One declared pack's three façades, as ADR-0065 requires each to publish. */
export interface LoadedExtensionPack {
  readonly pack: ExtensionPackDescriptor
  readonly control: ExtensionControlDescriptor
  readonly runtime: ExtensionRuntimeDescriptor
}

/** Loaded packs keyed by the binding name `db.extensions` spells. */
export type LoadedExtensionPacks = Record<string, LoadedExtensionPack>

/**
 * Thrown when a declared extension pack cannot be imported, or imports without
 * a usable descriptor on one of its three subpaths.
 *
 * Resolution runs from core's own module, so a pack the consuming package
 * depends on must also be reachable from `@opensaas/stack-core`. Where it is
 * not, load the pack in the test and pass it as `options.packs`.
 */
export class ExtensionPackUnavailableError extends Error {
  constructor(
    readonly pack: string,
    readonly specifier: string,
    readonly reason: string,
  ) {
    super(
      `The test harness could not load extension pack "${pack}" from "${specifier}": ${reason}. ` +
        `A declared pack must publish /pack, /control and /runtime (ADR-0065) and must be ` +
        `resolvable from @opensaas/stack-core. Install the package, or load the three subpaths ` +
        `in your test and pass them to createTestDatabase as options.packs["${pack}"].`,
    )
    this.name = 'ExtensionPackUnavailableError'
  }
}

/**
 * Every pack descriptor Prisma publishes carries a string `kind` and a string
 * `id`; the seed phase and the control client both key on `id`. Checking those
 * two is what the CLI's own loader checks, and it is what separates "a pack
 * built against a different toolchain generation" from a `TypeError` thrown
 * from inside Prisma.
 */
function isDescriptor(value: unknown): value is { kind: string; id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'kind' in value &&
    typeof value.kind === 'string'
  )
}

function isPackDescriptor(value: unknown): value is ExtensionPackDescriptor {
  return isDescriptor(value)
}

function isControlDescriptor(value: unknown): value is ExtensionControlDescriptor {
  return isDescriptor(value)
}

function isRuntimeDescriptor(value: unknown): value is ExtensionRuntimeDescriptor {
  return isDescriptor(value)
}

async function loadDefault(pack: string, specifier: string): Promise<unknown> {
  let namespace: unknown
  try {
    namespace = await import(specifier)
  } catch (error) {
    throw new ExtensionPackUnavailableError(
      pack,
      specifier,
      error instanceof Error ? error.message : 'the import failed',
    )
  }
  if (typeof namespace !== 'object' || namespace === null || !('default' in namespace)) {
    throw new ExtensionPackUnavailableError(pack, specifier, 'it has no default export')
  }
  return namespace.default
}

/**
 * Load the `/pack`, `/control` and `/runtime` façades of every pack a derived
 * contract declares, so the harness can build the contract, seed the extension
 * contract space and bind the runtime from one declaration (ADR-0065).
 *
 * The imports are dynamic and run only for a config that declares a pack, so a
 * suite over a pack-free config never reaches the pack packages.
 *
 * @param packs - Already-loaded packs, by binding name. An entry here is used
 *   as given and its subpaths are never imported.
 * @throws {ExtensionPackUnavailableError} naming the pack, the subpath and why.
 */
export async function loadExtensionPacks(
  extensions: readonly ExtensionDescriptor[],
  packs: LoadedExtensionPacks = {},
): Promise<LoadedExtensionPacks> {
  const loaded: LoadedExtensionPacks = {}

  for (const extension of extensions) {
    const provided = packs[extension.name]
    if (provided !== undefined) {
      loaded[extension.name] = provided
      continue
    }

    const packSpecifier = `${extension.from}/pack`
    const controlSpecifier = `${extension.from}/control`
    const runtimeSpecifier = `${extension.from}/runtime`

    const pack = await loadDefault(extension.name, packSpecifier)
    if (!isPackDescriptor(pack)) {
      throw new ExtensionPackUnavailableError(
        extension.name,
        packSpecifier,
        'its default export is not a pack descriptor',
      )
    }
    const control = await loadDefault(extension.name, controlSpecifier)
    if (!isControlDescriptor(control)) {
      throw new ExtensionPackUnavailableError(
        extension.name,
        controlSpecifier,
        'its default export is not a control descriptor',
      )
    }
    const runtime = await loadDefault(extension.name, runtimeSpecifier)
    if (!isRuntimeDescriptor(runtime)) {
      throw new ExtensionPackUnavailableError(
        extension.name,
        runtimeSpecifier,
        'its default export is not a runtime descriptor',
      )
    }

    loaded[extension.name] = { pack, control, runtime }
  }

  return loaded
}

/** The contract builder's `packs` option, projected off the loaded façades. */
export function contractPacks(loaded: LoadedExtensionPacks): PrismaContractPacks {
  const packs: PrismaContractPacks = {}
  for (const [name, loadedPack] of Object.entries(loaded)) packs[name] = loadedPack.pack
  return packs
}
