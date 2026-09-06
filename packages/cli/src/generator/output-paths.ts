import * as path from 'path'
import type { OutputConfig } from '@opensaas/stack-core'

/**
 * Default output locations, relative to the project root. Keeping these here
 * (rather than scattering string literals across the generator) means the
 * "no `output` block" path is one decision in one place.
 */
export const DEFAULT_CONTRACT_MODULE = 'prisma/contract.ts'
export const DEFAULT_OPENSAAS_DIR = '.opensaas'

/**
 * The files written into the `.opensaas` bundle directory. These names are
 * not configurable — only the directory that holds them moves.
 */
export const OPENSAAS_FILES = {
  types: 'types.ts',
  lists: 'lists.ts',
  context: 'context.ts',
  pluginTypes: 'plugin-types.ts',
  tables: 'tables.ts',
} as const

/**
 * The two artifacts `prisma contract emit` writes beside the Contract module.
 */
export const CONTRACT_ARTIFACTS = {
  json: 'contract.json',
  types: 'contract.d.ts',
} as const

/**
 * Absolute write paths for every file the generator emits, plus the two the
 * Prisma CLI emits on its behalf.
 */
export interface ResolvedWritePaths {
  /** Absolute path to the generated Contract module (`prisma/contract.ts`). */
  contractModule: string
  /** Absolute path to the directory holding the Contract module and its artifacts. */
  contractDir: string
  /** Absolute path to `<contractDir>/contract.json`, written by `prisma contract emit`. */
  contractJson: string
  /** Absolute path to `<contractDir>/contract.d.ts`, written by `prisma contract emit`. */
  contractTypes: string
  /** Absolute path to the top-level `prisma.config.ts` (never relocated). */
  prismaConfig: string
  /** Absolute path to the resolved `.opensaas` bundle directory. */
  opensaasDir: string
  /** Absolute path to `<opensaasDir>/types.ts`. */
  types: string
  /** Absolute path to `<opensaasDir>/lists.ts`. */
  lists: string
  /** Absolute path to `<opensaasDir>/context.ts`. */
  context: string
  /** Absolute path to `<opensaasDir>/plugin-types.ts`. */
  pluginTypes: string
  /** Absolute path to `<opensaasDir>/tables.ts` — the dependency-set table and constraint map. */
  tables: string
}

/**
 * Relative cross-references baked into the generated files. These follow the
 * configured locations so the emitted code resolves regardless of where the
 * Contract module and bundle live.
 */
export interface ResolvedCrossReferences {
  /**
   * `prisma.config.ts`'s `contract` field — the Contract module relative to the
   * project root, POSIX-separated and explicitly relative.
   * @example "./prisma/contract.ts"
   */
  prismaConfigContract: string
  /**
   * `prisma.config.ts`'s `output` field — the directory `contract.json` and
   * `contract.d.ts` land in, which is the Contract module's own directory.
   * @example "./prisma"
   */
  prismaConfigOutput: string
  /**
   * Module specifier for importing the emitted `contract.json` from inside the
   * bundle (used by `context.ts`) — relative to the `.opensaas` directory.
   * @example "../prisma/contract.json"
   */
  contractJsonImport: string
  /**
   * Module specifier for importing `opensaas.config` from inside the bundle
   * (used by `context.ts`) — relative to the `.opensaas` directory.
   * @example "../opensaas.config"
   */
  configImport: string
}

/**
 * Resolved output paths plus the cross-references the generated files embed.
 */
export interface ResolvedOutputPaths {
  paths: ResolvedWritePaths
  crossReferences: ResolvedCrossReferences
}

/**
 * Convert a (possibly Windows) relative path into a POSIX module specifier,
 * kept explicitly relative so it is never read as a bare package specifier.
 */
function toModuleSpecifier(relative: string): string {
  const posix = relative.split(path.sep).join('/')
  if (posix === '') return '.'
  return posix.startsWith('.') ? posix : `./${posix}`
}

/**
 * Pure resolver: given the project root and the user's `output` config, compute
 * where every generated file is written and the relative cross-references that
 * tie them together (see {@link ResolvedCrossReferences} for what each one is
 * for). Performs no I/O.
 *
 * `.opensaas` bundle directory precedence (highest first):
 * 1. `output.opensaasDir` (the new `output` block)
 * 2. `opensaasPathFallback` — the pre-existing top-level `config.opensaasPath`
 *    option, preserved so setting it alone still relocates the bundle through
 *    the CLI exactly as before
 * 3. the default `.opensaas`
 *
 * @param opensaasPathFallback - The pre-existing `config.opensaasPath` value,
 *   used as the bundle directory when no `output.opensaasDir` is set.
 */
export function resolveOutputPaths(
  cwd: string,
  output?: OutputConfig,
  opensaasPathFallback?: string,
): ResolvedOutputPaths {
  const contractModuleRel = output?.contractModule ?? DEFAULT_CONTRACT_MODULE
  const opensaasDirRel = output?.opensaasDir ?? opensaasPathFallback ?? DEFAULT_OPENSAAS_DIR

  const contractModuleAbs = path.resolve(cwd, contractModuleRel)
  const contractDirAbs = path.dirname(contractModuleAbs)
  const opensaasDirAbs = path.resolve(cwd, opensaasDirRel)

  const paths: ResolvedWritePaths = {
    contractModule: contractModuleAbs,
    contractDir: contractDirAbs,
    contractJson: path.join(contractDirAbs, CONTRACT_ARTIFACTS.json),
    contractTypes: path.join(contractDirAbs, CONTRACT_ARTIFACTS.types),
    // prisma.config.ts is always written at the project root (not configurable).
    prismaConfig: path.resolve(cwd, 'prisma.config.ts'),
    opensaasDir: opensaasDirAbs,
    types: path.join(opensaasDirAbs, OPENSAAS_FILES.types),
    lists: path.join(opensaasDirAbs, OPENSAAS_FILES.lists),
    context: path.join(opensaasDirAbs, OPENSAAS_FILES.context),
    pluginTypes: path.join(opensaasDirAbs, OPENSAAS_FILES.pluginTypes),
    tables: path.join(opensaasDirAbs, OPENSAAS_FILES.tables),
  }

  const crossReferences: ResolvedCrossReferences = {
    prismaConfigContract: toModuleSpecifier(path.relative(cwd, contractModuleAbs)),
    prismaConfigOutput: toModuleSpecifier(path.relative(cwd, contractDirAbs)),
    contractJsonImport: toModuleSpecifier(path.relative(opensaasDirAbs, paths.contractJson)),
    configImport: toModuleSpecifier(
      path.join(path.relative(opensaasDirAbs, cwd), 'opensaas.config'),
    ),
  }

  return { paths, crossReferences }
}

/**
 * The same set of files, redirected under a staging directory: the Contract
 * module and the two artifacts `prisma contract emit` writes beside it in one
 * subdirectory, the bundle in another, and the Prisma config that drives the
 * staged emission at the top.
 *
 * The two subdirectories keep a Contract module named after a bundle file from
 * landing on top of it, since both sets are flattened into one place here.
 *
 * @example
 * ```typescript
 * const staged = stageWritePaths(paths, path.join(cwd, '.opensaas', 'staged'))
 * writeContractModule(contractData, staged.contractModule)
 * ```
 */
export function stageWritePaths(paths: ResolvedWritePaths, stagingDir: string): ResolvedWritePaths {
  const contractDir = path.join(stagingDir, 'contract')
  const bundleDir = path.join(stagingDir, 'bundle')

  return {
    contractModule: path.join(contractDir, path.basename(paths.contractModule)),
    contractDir,
    contractJson: path.join(contractDir, CONTRACT_ARTIFACTS.json),
    contractTypes: path.join(contractDir, CONTRACT_ARTIFACTS.types),
    prismaConfig: path.join(stagingDir, 'prisma.config.ts'),
    opensaasDir: bundleDir,
    types: path.join(bundleDir, OPENSAAS_FILES.types),
    lists: path.join(bundleDir, OPENSAAS_FILES.lists),
    context: path.join(bundleDir, OPENSAAS_FILES.context),
    pluginTypes: path.join(bundleDir, OPENSAAS_FILES.pluginTypes),
    tables: path.join(bundleDir, OPENSAAS_FILES.tables),
  }
}
