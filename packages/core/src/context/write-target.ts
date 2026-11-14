import type { ListConfig, OpenSaasConfig } from '../config/types.js'
import type { AccessContext, OrmRow, PrismaFilter } from '../access/types.js'
import { assertAccessFilterConstrains, checkAccess } from '../access/engine.js'
import { guardedRuleItem, NO_RULE_VIEWS, ruleRowOf } from '../access/rule-item.js'
import {
  firstMatching,
  identityPredicate,
  whereCombinators,
  writeCollection,
  type WhereCombinators,
  type WriteCollection,
  type WriteScope,
} from '../secured/write.js'
import { resolveWhere, type WherePlan } from '../secured/vocabulary.js'

/**
 * Result of resolving a write target (axis 1). `denied` covers access denial,
 * a missing target, or a filter non-match alike, and short-circuits to `null`
 * before any hooks or the DB call.
 *
 * `scope` is the predicate the write itself then runs under: the engine's own
 * identity predicate, and the Access Filter beside it when the list's rule
 * returned one, so an `UPDATE` is scoped by the same filter the target read
 * was (ADR-0044).
 */
export type TargetResolution =
  { status: 'ok'; originalItem: OrmRow | undefined; scope: WriteScope } | { status: 'denied' }

/**
 * The Access Filter as a predicate to AND into the write's own, lowered
 * through the same seam a read lowers it through: trusted config, so its keys
 * are not read-gated, but total, so a rule that resolved to `undefined` is
 * refused rather than dropped (ADR-0022, ADR-0055).
 */
async function accessFilterPlan(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  config: OpenSaasConfig,
  context: AccessContext,
  filter: PrismaFilter,
): Promise<WherePlan> {
  assertAccessFilterConstrains(filter)
  return await resolveWhere(filter, {
    listName,
    listConfig,
    config,
    session: context.session,
    context,
    checkFieldRead: false,
    applyRelationAccess: true,
    accessFilterPath: [listName],
  })
}

/**
 * Build the shared target resolution for update/delete: read the row by
 * identity (missing → denied), check operation-level access (false → denied),
 * and if access returns a filter, re-read under the filter as well (no match →
 * denied) and carry it forward as part of the write's own predicate.
 *
 * The second read is what gates the hooks: a filter non-match must short-
 * circuit to `null` before `beforeOperation` runs, which a scope merged into
 * the write alone could not do.
 */
export function resolveExistingTarget(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  config: OpenSaasConfig,
  where: { id: string | number },
  access: 'update' | 'delete',
): (
  collection: WriteCollection,
  ops: WhereCombinators,
  context: AccessContext,
) => Promise<TargetResolution> {
  return async (collection, ops, context) => {
    const identity = identityPredicate(listName, where.id)
    const item = await firstMatching(collection, [identity], ops)
    if (!item) {
      return { status: 'denied' }
    }
    return await resolveTargetOfRow(
      { listName, listConfig, config, identity, item, access },
      collection,
      ops,
      context,
    )
  }
}

async function resolveTargetOfRow(
  target: {
    listName: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
    listConfig: ListConfig<any>
    config: OpenSaasConfig
    identity: WherePlan
    item: OrmRow
    access: 'update' | 'delete'
  },
  collection: WriteCollection,
  ops: WhereCombinators,
  context: AccessContext,
): Promise<TargetResolution> {
  const { listName, listConfig, config, identity, item, access } = target
  if (context._isSudo) {
    return { status: 'ok', originalItem: item, scope: [identity] }
  }

  const guard = guardedRuleItem(ruleRowOf(item, NO_RULE_VIEWS, listConfig.fields, config, listName))
  let accessResult: Awaited<ReturnType<typeof checkAccess>>
  try {
    accessResult = await checkAccess(listConfig.access?.operation?.[access], {
      session: context.session,
      item: guard.item,
      context,
    })
  } catch (err) {
    if (err instanceof TypeError && guard.tripped()) return { status: 'denied' }
    throw err
  }
  if (guard.tripped()) return { status: 'denied' }

  if (accessResult === false) {
    return { status: 'denied' }
  }

  if (accessResult === true) {
    return { status: 'ok', originalItem: item, scope: [identity] }
  }

  const filter = await accessFilterPlan(listName, listConfig, config, context, accessResult)
  const scope: WriteScope = [identity, filter]
  const scopedItem = await firstMatching(collection, scope, ops)
  if (!scopedItem) {
    return { status: 'denied' }
  }

  return { status: 'ok', originalItem: item, scope }
}

/**
 * The stored row of `listKey` whose id is `id`, as an update or a delete reads
 * it before deciding its target: every column, no relation, no access applied.
 */
export async function readStoredRow(
  context: AccessContext,
  listKey: string,
  id: string | number,
): Promise<OrmRow | null> {
  return await firstMatching(
    writeCollection(context.ormHandle, listKey),
    [identityPredicate(listKey, id)],
    await whereCombinators(),
  )
}

/**
 * Whether the engine would let `context` update or delete `item`, a stored row
 * of `listKey` read by {@link readStoredRow}: the target resolution an update
 * or a delete runs first, without the write.
 */
export async function writeTargetAllows(
  context: AccessContext,
  config: OpenSaasConfig,
  listKey: string,
  item: OrmRow,
  id: string | number,
  operation: 'update' | 'delete',
): Promise<boolean> {
  const resolution = await resolveTargetOfRow(
    {
      listName: listKey,
      listConfig: config.lists[listKey],
      config,
      identity: identityPredicate(listKey, id),
      item,
      access: operation,
    },
    writeCollection(context.ormHandle, listKey),
    await whereCombinators(),
    context,
  )
  return resolution.status === 'ok'
}
