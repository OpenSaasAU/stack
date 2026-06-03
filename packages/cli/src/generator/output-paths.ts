import * as path from 'path'
import type { OutputConfig } from '@opensaas/stack-core'

/**
 * Default output locations, relative to the project root. Keeping these here
 * (rather than scattering string literals across the generator) means the
 * "no `output` block" path is byte-identical to the historical behaviour.
 */
export const DEFAULT_PRISMA_SCHEMA = 'prisma/schema.prisma'
export const DEFAULT_OPENSAAS_DIR = '.opensaas'

/**
 * The five files written into the `.opensaas` bundle directory, plus the
 * sub-path of the patched Prisma client. These names are not configurable —
 * only the directory that holds them moves.
 */
export const OPENSAAS_FILES = {
  types: 'types.ts',
  lists: 'lists.ts',
  context: 'context.ts',
  pluginTypes: 'plugin-types.ts',
  prismaExtensions: 'prisma-extensions.ts',
  prismaClient: 'prisma-client',
} as const

/**
 * Absolute write paths for every file the generator emits.
 */
export interface ResolvedWritePaths {
  /** Absolute path to the Prisma schema file. */
  prismaSchema: string
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
  /** Absolute path to `<opensaasDir>/prisma-extensions.ts`. */
  prismaExtensions: string
}

/**
 * Relative cross-references baked into the generated files. These follow the
 * configured locations so the emitted code resolves regardless of where the
 * schema and bundle live.
 */
export interface ResolvedCrossReferences {
  /**
   * Module specifier for `prisma.config.ts`'s `schema` field — the schema
   * *directory* relative to the project root (Prisma resolves a directory or a
   * `.prisma` file). POSIX separators so the value is stable across platforms.
   * @example "prisma" | "prisma-opensaas"
   */
  prismaConfigSchema: string
  /**
   * Module specifier for the Prisma client `generator { output }` block — the
   * patched client directory relative to the schema *file's* directory.
   * @example "../.opensaas/prisma-client"
   */
  prismaClientOutput: string
  /**
   * Module specifier for importing `opensaas.config` from inside the bundle
   * (used by `context.ts` and `prisma-extensions.ts`) — relative to the
   * `.opensaas` directory.
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
 * Convert a (possibly Windows) relative path into a POSIX module specifier and
 * ensure it stays explicitly relative where a bare segment would otherwise be
 * read as a bare module specifier.
 */
function toModuleSpecifier(relative: string, { allowBare }: { allowBare: boolean }): string {
  const posix = relative.split(path.sep).join('/')
  if (allowBare) {
    // A directory reference for prisma.config's `schema` field — bare is fine,
    // but a schema at the project root yields an empty relative path, which
    // Prisma would reject; emit `.` instead.
    return posix === '' ? '.' : posix
  }
  // An import specifier — must be explicitly relative so it isn't treated as a
  // node_modules package.
  return posix.startsWith('.') ? posix : `./${posix}`
}

/**
 * Pure resolver: given the project root and the user's `output` config, compute
 * where every generated file is written and the relative cross-references that
 * tie them together. Performs no I/O.
 *
 * Cross-reference computation:
 * - `prismaConfigSchema` — the schema *directory* relative to the project root,
 *   so the top-level `prisma.config.ts` points the Prisma CLI at the relocated
 *   schema.
 * - `prismaClientOutput` — the patched client directory relative to the schema
 *   *file's* directory, since Prisma's `generator { output }` is resolved from
 *   the schema file.
 * - `configImport` — `opensaas.config` relative to the `.opensaas` directory,
 *   since `context.ts`/`prisma-extensions.ts` live inside the bundle and import
 *   the project's config by relative path.
 */
export function resolveOutputPaths(cwd: string, output?: OutputConfig): ResolvedOutputPaths {
  const prismaSchemaRel = output?.prismaSchema ?? DEFAULT_PRISMA_SCHEMA
  const opensaasDirRel = output?.opensaasDir ?? DEFAULT_OPENSAAS_DIR

  const prismaSchemaAbs = path.resolve(cwd, prismaSchemaRel)
  const opensaasDirAbs = path.resolve(cwd, opensaasDirRel)
  const schemaDirAbs = path.dirname(prismaSchemaAbs)
  const prismaClientAbs = path.join(opensaasDirAbs, OPENSAAS_FILES.prismaClient)

  const paths: ResolvedWritePaths = {
    prismaSchema: prismaSchemaAbs,
    // prisma.config.ts is always written at the project root (not configurable).
    prismaConfig: path.resolve(cwd, 'prisma.config.ts'),
    opensaasDir: opensaasDirAbs,
    types: path.join(opensaasDirAbs, OPENSAAS_FILES.types),
    lists: path.join(opensaasDirAbs, OPENSAAS_FILES.lists),
    context: path.join(opensaasDirAbs, OPENSAAS_FILES.context),
    pluginTypes: path.join(opensaasDirAbs, OPENSAAS_FILES.pluginTypes),
    prismaExtensions: path.join(opensaasDirAbs, OPENSAAS_FILES.prismaExtensions),
  }

  const crossReferences: ResolvedCrossReferences = {
    prismaConfigSchema: toModuleSpecifier(path.relative(cwd, schemaDirAbs), { allowBare: true }),
    prismaClientOutput: toModuleSpecifier(path.relative(schemaDirAbs, prismaClientAbs), {
      allowBare: false,
    }),
    configImport: toModuleSpecifier(
      path.join(path.relative(opensaasDirAbs, cwd), 'opensaas.config'),
      {
        allowBare: false,
      },
    ),
  }

  return { paths, crossReferences }
}
