import type { AccessContext, ListConfig, ListUIOption } from '@opensaas/stack-core'

export interface ResolvedListUi {
  hideCreate: boolean
  hideDelete: boolean
  fieldMode: 'edit' | 'read'
}

async function resolveOption<TValue extends string | boolean>(
  option: ListUIOption<TValue> | undefined,
  fallback: TValue,
  context: AccessContext,
): Promise<TValue> {
  if (option === undefined) return fallback
  if (typeof option !== 'function') return option
  return option({ session: context.session, context })
}

/**
 * Resolve a list's `ui.hideCreate`, `ui.hideDelete` and
 * `ui.itemView.defaultFieldMode` against the live session. Only the resolved
 * values may cross into client components.
 */
export async function resolveListUi(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig is generic over TypeInfo
  listConfig: ListConfig<any> | undefined,
  context: AccessContext,
): Promise<ResolvedListUi> {
  const ui = listConfig?.ui
  const [hideCreate, hideDelete, fieldMode] = await Promise.all([
    resolveOption(ui?.hideCreate, false, context),
    resolveOption(ui?.hideDelete, false, context),
    resolveOption(ui?.itemView?.defaultFieldMode, 'edit', context),
  ])
  return { hideCreate, hideDelete, fieldMode }
}
