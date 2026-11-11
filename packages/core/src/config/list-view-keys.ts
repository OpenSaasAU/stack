import type { OpenSaasConfig } from './types.js'

export function assertUniqueListViewKeys(
  config: OpenSaasConfig,
  property: 'presets' | 'rowActions',
  noun: string,
): OpenSaasConfig {
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    const seen = new Set<string>()
    for (const { key } of listConfig.ui?.listView?.[property] ?? []) {
      if (key === '') {
        throw new Error(
          `List "${listKey}" declares a ${noun} with an empty key in ui.listView.${property}. Give each ${noun} a non-empty key.`,
        )
      }
      if (seen.has(key)) {
        throw new Error(
          `List "${listKey}" declares the ${noun} key "${key}" more than once in ui.listView.${property}. Give each ${noun} its own key.`,
        )
      }
      seen.add(key)
    }
  }
  return config
}

export const assertUniqueRowActionKeys = (config: OpenSaasConfig): OpenSaasConfig =>
  assertUniqueListViewKeys(config, 'rowActions', 'Row action')

export const assertUniquePresetKeys = (config: OpenSaasConfig): OpenSaasConfig =>
  assertUniqueListViewKeys(config, 'presets', 'Preset view')
