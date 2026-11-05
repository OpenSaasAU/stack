import * as fs from 'fs'
import * as path from 'path'
import { createJiti } from 'jiti'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { resolveTsconfigAlias } from './tsconfig-alias.js'

const DEV_ENV_FILES = ['.env.development.local', '.env.local', '.env.development', '.env'] as const

/**
 * Loads the project's env files before `opensaas.config.ts` is read, in the
 * precedence Next applies under `next dev`. A variable already in the
 * environment is never overwritten, so a shell value wins.
 *
 * Returns the file each newly set variable came from.
 */
export function loadProjectEnvFile(cwd: string): Map<string, string> {
  const sources = new Map<string, string>()
  for (const name of DEV_ENV_FILES) {
    const file = path.join(cwd, name)
    if (!fs.existsSync(file)) continue
    const before = new Set(Object.keys(process.env))
    process.loadEnvFile(file)
    for (const key of Object.keys(process.env)) {
      if (!before.has(key)) sources.set(key, name)
    }
  }
  return sources
}

/** A loaded `opensaas.config.ts`, with whatever the alias resolution wants to say. */
export interface LoadedOpenSaasConfig {
  config: OpenSaasConfig
  /** Messages from resolving the project's tsconfig path aliases, for the caller to print. */
  aliasWarnings: string[]
  /**
   * Absolute paths of every project-local module the config imported, direct
   * or transitive, besides the config file itself. A dependency resolved into
   * `node_modules` is never included — a config split across its own modules
   * is what this reports, not the packages it depends on (#1414).
   */
  resolvedModules: string[]
}

function isInNodeModules(modulePath: string): boolean {
  return modulePath.split(path.sep).includes('node_modules')
}

/**
 * Load a project's `opensaas.config.ts` the way every command that reads it
 * must: through jiti, under the project's own tsconfig path aliases, awaiting
 * a default export that is a `Promise` whenever the config declares plugins.
 * Every call reads the files' current bytes, including after a load that threw.
 *
 * @example
 * ```typescript
 * const { config, aliasWarnings, resolvedModules } = await loadOpenSaasConfig(cwd, configPath)
 * ```
 */
export async function loadOpenSaasConfig(
  cwd: string,
  configPath: string,
): Promise<LoadedOpenSaasConfig> {
  const { alias, warnings } = resolveTsconfigAlias(cwd)

  // Module caching is on only long enough to read the resolved import graph back
  // off jiti's cache, which is Node's process-wide `require.cache`: that is why
  // only entries this project owns are ever deleted, and everything else there
  // is left alone. jiti does not clean up after an async evaluation that
  // rejects, so eviction has to run on the failure path too, or the next load
  // treats the failed load's entries as someone else's and never clears them.
  const jiti = createJiti(cwd, { interopDefault: true, alias, moduleCache: true })
  for (const modulePath of Object.keys(jiti.cache)) {
    if (
      modulePath === configPath ||
      (modulePath.startsWith(`${cwd}${path.sep}`) && !isInNodeModules(modulePath))
    ) {
      delete jiti.cache[modulePath]
    }
  }
  const cachedBeforeLoad = new Set(Object.keys(jiti.cache))

  let config: OpenSaasConfig
  let newlyCached: string[]
  try {
    // jiti's `interopDefault` doesn't unwrap an async `default` export, so the
    // module's own default is awaited here.
    const module = await jiti.import<{ default: OpenSaasConfig | Promise<OpenSaasConfig> }>(
      configPath,
    )
    config = await module.default
  } finally {
    // Cleared wherever it resolved to: a `node_modules` package still on its
    // source form (a workspace link, a git dependency) goes through the same
    // transform and caches exactly like a project file.
    newlyCached = Object.keys(jiti.cache).filter((modulePath) => !cachedBeforeLoad.has(modulePath))
    for (const modulePath of newlyCached) delete jiti.cache[modulePath]
  }

  const resolvedModules = newlyCached.filter(
    (modulePath) => modulePath !== configPath && !isInNodeModules(modulePath),
  )

  return { config, aliasWarnings: warnings, resolvedModules }
}
