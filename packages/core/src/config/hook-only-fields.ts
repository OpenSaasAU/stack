import type { OpenSaasConfig } from './types.js'

export function assertValidHookOnlyFields(config: OpenSaasConfig): OpenSaasConfig {
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
      const access: Record<string, unknown> | undefined = fieldConfig.access
      if (!access || !('write' in access) || access.write === undefined) continue
      if (access.write !== 'hooks') {
        throw new Error(
          `${listKey}.${fieldName}: access.write must be 'hooks', got ${JSON.stringify(access.write)}.`,
        )
      }
      if (access.create !== undefined || access.update !== undefined) {
        throw new Error(
          `${listKey}.${fieldName}: access.write 'hooks' cannot be combined with access.create or access.update.`,
        )
      }
    }
  }
  return config
}
