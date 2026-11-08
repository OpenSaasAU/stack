import type { AccessContext } from '../access/types.js'
import { parseFilterQuery } from '../filter/parse.js'
import { serializeFilterQuery } from '../filter/serialize.js'
import { checkHasAccess } from './has-access-gate.js'
import type { OpenSaasConfig, PresetView } from './types.js'

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
  tabs: Promise<PresetViewTab[]>
  active: Promise<ResolvedPresetView | null>
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

async function resolveActive(
  preset: PresetView,
  gate: Promise<boolean>,
  context: AccessContext,
  listKey: string,
): Promise<ResolvedPresetView | null> {
  if (!(await gate)) return null
  const search = await resolveSearch(preset, context, listKey)
  if (search === null) return null
  return { key: preset.key, search, ...(preset.sort ? { sort: preset.sort } : {}) }
}

/**
 * Start resolving a list's Preset views for this session. Every `hasAccess`
 * gate starts at once and runs once: `active` waits only on the requested
 * preset's gate and `search`, so the list read need not wait for the tabs.
 */
export function resolvePresetViews(
  listConfig: Pick<OpenSaasConfig['lists'][string], 'ui'>,
  listKey: string,
  context: AccessContext,
  requested: string | undefined,
): ResolvedPresetViews {
  const presets = listConfig.ui?.listView?.presets ?? []
  const gates = presets.map((preset) => checkHasAccess(preset, context, listKey, 'Preset view'))
  const tabs = Promise.all(gates).then((allowed) =>
    presets
      .filter((_, index) => allowed[index])
      .map((preset) => ({ key: preset.key, label: preset.label })),
  )
  const index = requested === undefined ? -1 : presets.findIndex(({ key }) => key === requested)
  const active =
    index === -1
      ? Promise.resolve(null)
      : resolveActive(presets[index], gates[index], context, listKey)
  return { tabs, active }
}
