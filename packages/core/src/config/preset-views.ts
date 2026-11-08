import type { AccessContext } from '../access/types.js'
import { parseFilterQuery } from '../filter/parse.js'
import { serializeFilterQuery } from '../filter/serialize.js'
import type { OpenSaasConfig, PresetView } from './types.js'

export function assertUniquePresetKeys(config: OpenSaasConfig): OpenSaasConfig {
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    const seen = new Set<string>()
    for (const preset of listConfig.ui?.listView?.presets ?? []) {
      if (seen.has(preset.key)) {
        throw new Error(
          `List "${listKey}" declares the Preset view key "${preset.key}" more than once in ui.listView.presets. Give each Preset view its own key.`,
        )
      }
      seen.add(preset.key)
    }
  }
  return config
}

export interface PresetViewTab {
  key: string
  label: string
}

export interface ResolvedPresetView {
  key: string
  search: string
  sort?: PresetView['sort']
}

export interface ResolvedPresetViews {
  tabs: PresetViewTab[]
  active: ResolvedPresetView | null
}

async function mayOpen(preset: PresetView, context: AccessContext, listKey: string) {
  if (!preset.hasAccess) return true
  try {
    return (await preset.hasAccess({ session: context.session, context, listKey })) === true
  } catch (error) {
    console.error(`Preset view "${preset.key}" on "${listKey}" hasAccess threw:`, error)
    return false
  }
}

async function resolveSearch(
  preset: PresetView,
  context: AccessContext,
  listKey: string,
): Promise<string | null> {
  let search: unknown = preset.search
  if (typeof preset.search === 'function') {
    try {
      search = await preset.search({ session: context.session, context, listKey })
    } catch (error) {
      console.error(`Preset view "${preset.key}" on "${listKey}" search threw:`, error)
      return null
    }
  }
  if (typeof search !== 'string') {
    console.error(`Preset view "${preset.key}" on "${listKey}" search did not resolve to a string.`)
    return null
  }
  return serializeFilterQuery(parseFilterQuery(search))
}

export async function resolvePresetViews(
  listConfig: Pick<OpenSaasConfig['lists'][string], 'ui'>,
  listKey: string,
  context: AccessContext,
  requested: string | undefined,
): Promise<ResolvedPresetViews> {
  const presets = listConfig.ui?.listView?.presets ?? []
  if (presets.length === 0) return { tabs: [], active: null }
  const allowed = await Promise.all(presets.map((preset) => mayOpen(preset, context, listKey)))
  const visible = presets.filter((_, index) => allowed[index])
  const tabs = visible.map((preset) => ({ key: preset.key, label: preset.label }))
  const chosen =
    requested === undefined ? undefined : visible.find((preset) => preset.key === requested)
  if (!chosen) return { tabs, active: null }
  const search = await resolveSearch(chosen, context, listKey)
  if (search === null) return { tabs, active: null }
  return {
    tabs,
    active: { key: chosen.key, search, ...(chosen.sort ? { sort: chosen.sort } : {}) },
  }
}
