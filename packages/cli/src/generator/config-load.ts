import { createJiti } from 'jiti'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { resolveTsconfigAlias } from './tsconfig-alias.js'

/** A loaded `opensaas.config.ts`, with whatever the alias resolution wants to say. */
export interface LoadedOpenSaasConfig {
  config: OpenSaasConfig
  /** Messages from resolving the project's tsconfig path aliases, for the caller to print. */
  aliasWarnings: string[]
}

/**
 * Load a project's `opensaas.config.ts` the way every command that reads it
 * must: through jiti, under the project's own tsconfig path aliases, awaiting
 * a default export that is a `Promise` whenever the config declares plugins.
 *
 * @example
 * ```typescript
 * const { config, aliasWarnings } = await loadOpenSaasConfig(cwd, configPath)
 * ```
 */
export async function loadOpenSaasConfig(
  cwd: string,
  configPath: string,
): Promise<LoadedOpenSaasConfig> {
  const { alias, warnings } = resolveTsconfigAlias(cwd)
  const jiti = createJiti(cwd, { interopDefault: true, alias })

  // jiti's `interopDefault` doesn't unwrap an async `default` export, so the
  // module's own default is awaited here.
  const module = await jiti.import<{ default: OpenSaasConfig | Promise<OpenSaasConfig> }>(
    configPath,
  )

  return { config: await module.default, aliasWarnings: warnings }
}
