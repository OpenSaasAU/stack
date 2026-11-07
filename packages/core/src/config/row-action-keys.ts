import type { OpenSaasConfig } from './types.js'

export function assertUniqueRowActionKeys(config: OpenSaasConfig): OpenSaasConfig {
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    const seen = new Set<string>()
    for (const action of listConfig.ui?.listView?.rowActions ?? []) {
      if (seen.has(action.key)) {
        throw new Error(
          `List "${listKey}" declares the Row action key "${action.key}" more than once in ui.listView.rowActions. Give each Row action its own key.`,
        )
      }
      seen.add(action.key)
    }
  }
  return config
}
