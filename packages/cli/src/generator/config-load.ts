import * as path from 'path'
import { createJiti } from 'jiti'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { resolveTsconfigAlias } from './tsconfig-alias.js'

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

  // Module caching is enabled only long enough to read back the resolved
  // import graph off jiti's own cache (the `NodeRequire.cache` shape its
  // public API already documents), then cleared below — so a second load of
  // this exact path in the same process still sees fresh bytes. That cache is
  // Node's own process-wide `require.cache`, not an object private to this
  // jiti instance, which is why only the entries this load actually added are
  // deleted, never the ones already there before it ran.
  const jiti = createJiti(cwd, { interopDefault: true, alias, moduleCache: true })
  const cachedBeforeLoad = new Set(Object.keys(jiti.cache))

  // jiti's `interopDefault` doesn't unwrap an async `default` export, so the
  // module's own default is awaited here.
  const module = await jiti.import<{ default: OpenSaasConfig | Promise<OpenSaasConfig> }>(
    configPath,
  )

  const resolvedModules = Object.keys(jiti.cache).filter(
    (modulePath) =>
      !cachedBeforeLoad.has(modulePath) &&
      modulePath !== configPath &&
      !modulePath.split(path.sep).includes('node_modules'),
  )
  for (const modulePath of [configPath, ...resolvedModules]) delete jiti.cache[modulePath]

  return { config: await module.default, aliasWarnings: warnings, resolvedModules }
}
