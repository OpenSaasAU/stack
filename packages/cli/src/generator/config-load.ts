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

/**
 * Load a project's `opensaas.config.ts` the way every command that reads it
 * must: through jiti, under the project's own tsconfig path aliases, awaiting
 * a default export that is a `Promise` whenever the config declares plugins.
 *
 * Each load evaluates the config file, and every module it reaches that an
 * earlier load of this function cached, from their current bytes, including
 * after a load that threw. Two cases are outside that: a module some other
 * loader left in the process-wide cache keeps that loader's copy, and a module
 * first imported once the load has settled (from a plugin hook, or after a
 * rejected default export) stays cached.
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
  // this deletes the config path and the entries this load added, and nothing
  // else. jiti does not clean up after an async evaluation that rejects, so the
  // eviction has to run on the failure path too.
  const jiti = createJiti(cwd, { interopDefault: true, alias, moduleCache: true })
  delete jiti.cache[configPath]
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
    (modulePath) =>
      modulePath !== configPath && !modulePath.split(path.sep).includes('node_modules'),
  )

  return { config, aliasWarnings: warnings, resolvedModules }
}
