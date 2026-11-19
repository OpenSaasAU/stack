// Field Visibility: a read binding, raw rows and a resolved plan in, the rows a
// caller may see out — for every read terminal and every write return. ADR-0001,
// ADR-0027, ADR-0044, ADR-0051, ADR-0081, ADR-0082.

import type { AccessContext, OrmRow } from '../access/types.js'
import type { FieldConfig, ListConfig, TypeInfo } from '../config/types.js'
import { isComputedField } from '../config/field-kind.js'
import { checkRowRead } from '../access/field-access.js'
import {
  NO_RULE_VIEWS,
  ruleRowOf,
  type RuleRow,
  type RuleView,
  type RuleViewTree,
} from '../access/rule-item.js'
import { RESOLVE_CHAIN_MAX_LENGTH } from '../access/depth-limits.js'
import { ResolveOutputCycleError } from '../access/errors.js'
import { withDerivedSessionVocabulary } from '../access/session-vocabulary.js'
import { getListDependencies } from '../access/declared-dependencies.js'
import { partColumnsOf, resolveListMembers, type ListMembers } from '../members/list-members.js'
import type { FieldDependencySet } from '../contract/dependencies.js'
import { lowerWhere, whereCombinators } from './lower.js'
import { resolveRelatedAccessPlan, type ResolveContext } from './vocabulary.js'
import {
  DECLARED_COUNT_BRANCH_KEY,
  DECLARED_ROWS_BRANCH_KEY,
  type IncludePlan,
  type PlanLevel,
  type ReducePlan,
} from './include.js'
import type { RowLockKey } from './lock.js'
import { collectionFor, engineRead, identityIn, type ReadBinding } from './binding.js'

type VisibilityBinding = Omit<ReadBinding, 'lock'>

declare const VISIBLE_ROW: unique symbol

/**
 * A row that has been through {@link visibleRows} — Field Visibility and both
 * foreign-key passes — or is {@link systemFieldsRow}'s, and nothing else.
 * `OrmRow` has no property keyed by this module-private symbol, so an
 * unbranded row is not assignable where a `VisibleRow` is expected:
 * {@link minted} is the only place one is made, and every terminal and write
 * return is typed to return what it mints rather than a plain `OrmRow`. A
 * terminal or write path added later that materialises rows without calling
 * {@link visibleRows} therefore fails to compile instead of shipping the
 * silent access-control regression this codebase has shipped four times
 * (issue #1386). This closes the failure mode of *forgetting* the funnel, not
 * the one of a future author deliberately reaching for `as VisibleRow` on an
 * unfiltered row — no nominal brand in TypeScript stops that.
 */
export type VisibleRow = OrmRow & { readonly [VISIBLE_ROW]: true }

function minted(rows: OrmRow[]): VisibleRow[] {
  return rows as VisibleRow[]
}

/**
 * What decides a write's return: `hidden` when the session cannot `query` the
 * row, `written` when the row the write produced is the whole answer, and
 * `read` when a computed field on the list declares a relation, so the answer
 * is the row as `first()` reads it (ADR-0081).
 */
export type WrittenRowRead =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'written'; readonly root: PlanLevel }
  | { readonly kind: 'read'; readonly row: OrmRow; readonly root: PlanLevel }

/**
 * What every read terminal returns rows through, and the only place any
 * foreign-key pass runs.
 *
 * The batch is what lets {@link narrowUnincludedForeignKeys} resolve a
 * to-one this read never named at all for a whole page in one query per
 * relation rather than one per row.
 */
export async function visibleRows(
  binding: VisibilityBinding,
  rows: readonly OrmRow[],
  root: PlanLevel,
): Promise<VisibleRow[]> {
  const ruleViews = await ruleViewTreeFor(binding, root, rows)
  const results = await Promise.all(
    rows.map(async (row) => {
      const filtered = await filterReadableFields(
        maskReductions(row, root.includes),
        root,
        binding,
        ruleViews,
      )
      applyForeignKeys(filtered, root.includes)
      restoreReductions(filtered, row, root.includes)
      return filtered
    }),
  )
  await narrowUnincludedForeignKeys(binding, results, rows, root, ruleViews)
  return minted(results)
}

/**
 * What a write hands back: the re-read row under its own plan, or the write's
 * own row under a plan with no includes, so `create()` and `update()` never
 * return an id `first()` hides. A row the session cannot `query` comes back as
 * the list's system fields alone.
 */
export async function visibleWrittenRow(
  binding: VisibilityBinding,
  row: OrmRow,
  read: WrittenRowRead,
): Promise<VisibleRow> {
  if (read.kind === 'hidden') return systemFieldsRow(binding, row)
  const [visible] = await visibleRows(binding, [read.kind === 'read' ? read.row : row], read.root)
  return visible
}

function systemFieldsRow(binding: VisibilityBinding, row: OrmRow): VisibleRow {
  const kept: OrmRow = {}
  for (const key of getListDependencies(binding.config, binding.listName).systemFields) {
    if (key in row) kept[key] = row[key]
  }
  return minted([kept])[0]
}

type ResolveOutputHookRuntime = (args: {
  operation: 'query'
  value: unknown
  item: Record<string, unknown>
  listKey: string
  fieldName: string
  context: AccessContext
}) => unknown | Promise<unknown>

type FieldVisibilityArgs = {
  session: AccessContext['session']
  context: AccessContext
}

/**
 * A NEW context whose `_resolveOutputChain` extends the caller's with this
 * hook's own link, so concurrent hook invocations each see their own chain
 * (ADR-0023). `context.db`'s operations capture their context at construction,
 * so `db` is rebuilt against the derived context: without that, a hook's own
 * read would fall back to the un-extended chain and defeat the cycle guard.
 */
function deriveResolveOutputContext(
  binding: VisibilityBinding,
  context: AccessContext,
  link: { listKey: string; fieldKey: string },
): AccessContext {
  const derived: AccessContext = {
    ...context,
    _resolveOutputChain: [...context._resolveOutputChain, link],
  }
  derived.db = binding.rebindDb(derived)
  withDerivedSessionVocabulary(derived, context, binding.config)
  return derived
}

/**
 * The core Field Visibility step for a single field: check read access and, if
 * granted, produce the output value by running any `resolveOutput` hook.
 *
 * `ruleRow` is the row used to evaluate field access: the fetched row under its
 * `RuleView`, which a rule reads through a guard (ADR-0082). `hookItem` is the object passed
 * to the hook as `item`: exactly the field's own declared dependency set plus
 * the list's system fields, so a hook never sees another computed field's
 * resolved value and never sees what some other call site's projection
 * happened to fetch (ADR-0027, ADR-0051).
 */
async function resolveReadableFieldValue(params: {
  fieldConfig: FieldConfig | undefined
  fieldName: string
  value: unknown
  ruleRow: RuleRow
  hookItem: Record<string, unknown>
  listKey: string
  args: FieldVisibilityArgs
  binding: VisibilityBinding
}): Promise<{ readable: false } | { readable: true; value: unknown }> {
  const { fieldConfig, fieldName, value, ruleRow, hookItem, listKey, args, binding } = params

  const canRead = await checkRowRead(fieldConfig?.access, args, ruleRow)

  if (!canRead) {
    return { readable: false }
  }

  if (fieldConfig?.hooks?.resolveOutput) {
    // The hook is erased to this runtime shape here; at the actual call it
    // receives the value typed for its own field.
    const hook = fieldConfig.hooks.resolveOutput as unknown as ResolveOutputHookRuntime
    const link = { listKey, fieldKey: fieldName }
    const chain = args.context._resolveOutputChain

    // Cycle guard: a hook that would re-enter a (list, field) pair already on
    // its own chain cannot terminate — refuse loudly rather than recurse
    // until the process runs out of memory (issue #844, ADR-0023).
    const alreadyOnChain = chain.some(
      (entry) => entry.listKey === link.listKey && entry.fieldKey === link.fieldKey,
    )
    if (alreadyOnChain) {
      throw new ResolveOutputCycleError([...chain, link])
    }

    // Cost cap: a chain this long is refused only as a cost limit, never a
    // correctness one — an acyclic chain that works today can legitimately
    // reach this. Omit the field and warn instead of throwing.
    if (chain.length >= RESOLVE_CHAIN_MAX_LENGTH) {
      const path = [...chain, link].map((entry) => `${entry.listKey}.${entry.fieldKey}`).join(' → ')
      console.warn(
        `resolveOutput: omitting "${listKey}.${fieldName}" — its resolve chain exceeded ` +
          `RESOLVE_CHAIN_MAX_LENGTH (${RESOLVE_CHAIN_MAX_LENGTH}): ${path}. This is a cost limit, ` +
          `not an access denial.`,
      )
      return { readable: false }
    }

    const resolved = await Promise.resolve(
      hook({
        value,
        operation: 'query',
        fieldName,
        listKey,
        item: hookItem,
        context: deriveResolveOutputContext(binding, args.context, link),
      }),
    )
    return { readable: true, value: resolved }
  }

  return { readable: true, value }
}

/**
 * Strip what the session may not read from one row of `level`, run the
 * computed fields it returns, and descend into the relations the plan reached.
 * A field the level's selection leaves out does no work at all (ADR-0027).
 */
async function filterReadableFields(
  item: OrmRow,
  level: PlanLevel,
  binding: VisibilityBinding,
  ruleViews: RuleViewTree,
): Promise<OrmRow> {
  const { config } = binding
  const { listName: listKey, selection } = level
  const fieldConfigs = level.listConfig.fields
  const args: FieldVisibilityArgs = {
    session: binding.context.session,
    context: binding.context,
  }
  const filtered: Record<string, unknown> = {}

  // A multi-column field's raw part columns never leak: its logical value is
  // assembled under its own key and goes through the normal path (ADR-0006).
  const listMembers = resolveListMembers(config, listKey)
  const workingItem: Record<string, unknown> = { ...item }
  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    const columnNames = partColumnsOf(listMembers, fieldName)
    if (!fieldConfig.assembleColumns || !columnNames) continue
    const hasAnyColumn = columnNames.some((name) => name in workingItem)
    if (!hasAnyColumn) continue
    const assembled = fieldConfig.assembleColumns(fieldName, workingItem)
    for (const name of columnNames) {
      delete workingItem[name]
    }
    workingItem[fieldName] = assembled
  }

  const declaredDependencies: Readonly<Record<string, FieldDependencySet>> = getListDependencies(
    config,
    listKey,
  ).fields
  const systemFields = new Set<string>(listMembers.systemFields)

  const ruleRow = ruleRowOf(workingItem, ruleViews, fieldConfigs, config, listKey)
  const ruleItem = ruleRow.item

  const hookItemFor = (fieldName: string): Record<string, unknown> => {
    const declared = declaredDependencies[fieldName] ?? { columns: [], relations: [] }
    const hookItem: Record<string, unknown> = {}
    for (const key of [...systemFields, ...declared.columns, ...declared.relations]) {
      if (key in ruleItem) hookItem[key] = ruleItem[key]
    }
    return hookItem
  }

  const nodes = new Map(level.includes.map((plan) => [plan.relation, plan]))

  for (const [fieldName, rawValue] of Object.entries(workingItem)) {
    let value = rawValue
    const fieldConfig = fieldConfigs[fieldName]

    if (systemFields.has(fieldName)) {
      filtered[fieldName] = value
      continue
    }

    if (selection !== undefined && !selection.has(fieldName)) {
      continue
    }

    const node = nodes.get(fieldName)

    // A related row the plan has no node for has nothing to strip it by.
    if (node === undefined && fieldConfig?.type === 'relationship' && value != null) {
      continue
    }

    if (node !== undefined && value !== null && value !== undefined) {
      if (node.synthetic === undefined) {
        const canRead = await checkRowRead(fieldConfig?.access, args, ruleRow)

        // A `read` denial hides the relation from the CALLER and nothing
        // else: `hookItemFor` still hands it to any field that declared it
        // (ADR-0051).
        if (!canRead) continue

        // A branch the widening added returns to nobody, and nothing computes
        // on a declared branch (ADR-0051).
        if (node.declared) continue

        // `maskReductions`' declared-rows stand-in, passed through raw and
        // overwritten by `restoreReductions` with the reduction's own value.
        if (node.reducedDeclared) {
          filtered[fieldName] = value
          continue
        }
      } else if (Array.isArray(value)) {
        const gate = node.synthetic.gate
        const allowed = await Promise.all(
          value.map((relatedItem) =>
            checkRowRead(
              gate?.access,
              args,
              ruleRowOf(
                relatedItem,
                ruleViews.nested[fieldName] ?? NO_RULE_VIEWS,
                node.listConfig.fields,
                config,
                node.listName,
              ),
            ),
          ),
        )
        const readable = value.filter((_, index) => allowed[index])
        value = readable
      }
      const nestedRuleViews = ruleViews.nested[fieldName] ?? NO_RULE_VIEWS

      if (Array.isArray(value)) {
        filtered[fieldName] = await Promise.all(
          value.map((relatedItem) =>
            filterReadableFields(relatedItem, node, binding, nestedRuleViews),
          ),
        )
      } else if (isRow(value)) {
        filtered[fieldName] = await filterReadableFields(value, node, binding, nestedRuleViews)
      }
      continue
    }

    const result = await resolveReadableFieldValue({
      fieldConfig,
      fieldName,
      value,
      ruleRow,
      hookItem: hookItemFor(fieldName),
      listKey,
      args,
      binding,
    })

    if (result.readable) {
      filtered[fieldName] = result.value
    }
  }

  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    if (fieldName in filtered) {
      continue
    }

    if (selection !== undefined && !selection.has(fieldName)) {
      continue
    }

    if (!fieldConfig.hooks?.resolveOutput) {
      continue
    }

    // Checked last: it is the only one of the three that can run a
    // third-party field's own `getContractField` (issue #1531).
    if (!isComputedField(fieldConfig, fieldName, listKey, config)) {
      continue
    }

    const result = await resolveReadableFieldValue({
      fieldConfig,
      fieldName,
      value: undefined,
      ruleRow,
      hookItem: hookItemFor(fieldName),
      listKey,
      args,
      binding,
    })

    if (result.readable) {
      filtered[fieldName] = result.value
    }
  }

  // A declared dependency is private plumbing, never an implicit include: it
  // leaves the result once every hook at this level has read it (ADR-0025).
  for (const node of level.includes) {
    if (node.declared) delete filtered[node.relation]
  }

  return filtered
}

function isRow(value: unknown): value is OrmRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The rows one include plan contributed to a row, whichever shape the key
 * holds them in: a to-many's array, a to-one's single row, and a reduction's
 * envelope before {@link maskReductions} substitutes its rows back out.
 */
function relatedRowsOf(row: OrmRow, plan: IncludePlan): OrmRow[] {
  const value = row[plan.relation]
  if (Array.isArray(value)) return value.filter(isRow)
  if (plan.reduce !== undefined) return combinedRows(value, rowsKeyOf(plan))
  return isRow(value) ? [value] : []
}

/**
 * Narrow the foreign-key column of every included to-one to what the caller
 * may see: the related row's id when the relation is visible, `null` when it is
 * not — denied, scoped away and stripped alike (ADR-0058). Driven by the
 * contract's own foreign-key member, and run after the field strip so
 * visibility is authoritative over the column.
 *
 * A relation the caller's own `where()` refined is the exception: a `null`
 * there may be the caller's filter rather than access, so the column is left
 * for {@link narrowUnincludedForeignKeys}, which decides on access alone.
 */
function applyForeignKeys(row: OrmRow, plans: readonly IncludePlan[]): void {
  for (const plan of plans) {
    if (
      !plan.declared &&
      plan.arity === 'one' &&
      plan.foreignKey !== undefined &&
      plan.foreignKey in row
    ) {
      const value = row[plan.relation]
      if (isRow(value)) row[plan.foreignKey] = value.id
      else if (!plan.callerRefined) row[plan.foreignKey] = null
    }
    if (plan.includes.length === 0) continue
    for (const related of relatedRowsOf(row, plan)) applyForeignKeys(related, plan.includes)
  }
}

function relatedResolveContext(binding: VisibilityBinding, level: PlanLevel): ResolveContext {
  return {
    listName: level.listName,
    listConfig: level.listConfig,
    config: binding.config,
    session: binding.context.session,
    context: binding.context,
    checkFieldRead: false,
    applyRelationAccess: true,
    accessFilterPath: [],
  }
}

function assembleColumnFields(
  row: OrmRow,
  fieldConfigs: ListConfig<TypeInfo>['fields'],
  members: ListMembers,
): OrmRow {
  const assembled: OrmRow = { ...row }
  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    const columnNames = partColumnsOf(members, fieldName)
    if (!fieldConfig.assembleColumns || !columnNames) continue
    if (!columnNames.some((name) => name in assembled)) continue
    const value = fieldConfig.assembleColumns(fieldName, assembled)
    for (const name of columnNames) delete assembled[name]
    assembled[fieldName] = value
  }
  return assembled
}

/**
 * Pairs each shown related row with its raw twin. Field Visibility may drop
 * rows from a to-many (a synthetic back-relation's source `read` rule), so
 * once the lengths differ the pairing is by `id`, never by position.
 */
function pairRelatedRows(shown: readonly unknown[], raw: readonly unknown[]): [OrmRow, OrmRow][] {
  const pairs: [OrmRow, OrmRow][] = []
  if (shown.length === raw.length) {
    shown.forEach((related, index) => {
      const original = raw[index]
      if (isRow(related) && isRow(original)) pairs.push([related, original])
    })
    return pairs
  }
  const rawById = new Map<string, OrmRow>()
  for (const original of raw) if (isRow(original)) rawById.set(String(original.id), original)
  for (const related of shown) {
    if (!isRow(related)) continue
    const original = rawById.get(String(related.id))
    if (original !== undefined) pairs.push([related, original])
  }
  return pairs
}

/**
 * Narrow the foreign-key column of every to-one this read did NOT include or
 * declare (issue #1243): the owning field's own `read` rule per row, and the
 * related list's own `query` access — `false` nulls the column, and a filter is
 * one batched existence check per relation across the whole page.
 *
 * That existence check cannot tell a row the filter denies from a row deleted
 * between the two statements; absence nulls the column either way, so a
 * vanished row fails exactly as closed as a denied one (issue #1386).
 *
 * Runs after {@link applyForeignKeys}, on its output, mutated in place.
 */
async function narrowUnincludedForeignKeys(
  binding: VisibilityBinding,
  filteredRows: readonly OrmRow[],
  rawRows: readonly OrmRow[],
  level: PlanLevel,
  ruleViews: RuleViewTree,
): Promise<void> {
  if (binding.context._isSudo === true) return
  const ctx = relatedResolveContext(binding, level)
  const { listName, listConfig } = level

  const members = level.ownsForeignKeys ? resolveListMembers(binding.config, listName) : undefined
  const ruleRows =
    members === undefined
      ? []
      : rawRows.map((row) =>
          ruleRowOf(
            assembleColumnFields(maskReductions(row, level.includes), listConfig.fields, members),
            ruleViews,
            listConfig.fields,
            binding.config,
            listName,
          ),
        )

  for (const owner of level.unincludedForeignKeys) {
    if (!rawRows.some((row) => owner.foreignKey in row)) continue

    const related = owner.related
    const access = await resolveRelatedAccessPlan(related, ctx)

    for (let i = 0; i < filteredRows.length; i++) {
      const raw = rawRows[i]
      if (!(owner.foreignKey in raw) || !(owner.foreignKey in filteredRows[i])) continue
      const canReadField = await checkRowRead(
        owner.fieldConfig.access,
        { session: binding.context.session, context: binding.context },
        ruleRows[i],
      )
      if (!canReadField || access.kind === 'false') filteredRows[i][owner.foreignKey] = null
    }

    if (access.kind === 'true' || access.kind === 'false') continue

    const idsByRow = rawRows.map((row) => row[owner.foreignKey])
    const idMap = new Map<string, unknown>()
    for (let i = 0; i < filteredRows.length; i++) {
      if (!(owner.foreignKey in filteredRows[i]) || filteredRows[i][owner.foreignKey] === null)
        continue
      const value = idsByRow[i]
      if (value !== null && value !== undefined) idMap.set(String(value), value)
    }
    if (idMap.size === 0) continue

    const ops = await whereCombinators()
    const visible = await engineRead(binding, () =>
      collectionFor(binding.ormHandle, related.listName)
        .where((model) => lowerWhere(access, model, ops))
        .where((model) => identityIn(model, related.listName, [...idMap.values()] as RowLockKey[]))
        .select('id')
        .all(),
    )
    const visibleIds = new Set(visible.map((row) => String(row.id)))

    for (let i = 0; i < filteredRows.length; i++) {
      if (!(owner.foreignKey in filteredRows[i]) || filteredRows[i][owner.foreignKey] === null)
        continue
      const value = idsByRow[i]
      if (value === null || value === undefined) continue
      if (!visibleIds.has(String(value))) filteredRows[i][owner.foreignKey] = null
    }
  }

  for (const plan of level.includes) {
    const nestedFiltered: OrmRow[] = []
    const nestedRaw: OrmRow[] = []
    for (let i = 0; i < filteredRows.length; i++) {
      const filteredValue = filteredRows[i][plan.relation]
      const rawValue = rawRows[i][plan.relation]
      if (Array.isArray(filteredValue) && Array.isArray(rawValue)) {
        for (const [related, original] of pairRelatedRows(filteredValue, rawValue)) {
          nestedFiltered.push(related)
          nestedRaw.push(original)
        }
      } else if (plan.reduce !== undefined) {
        const key = rowsKeyOf(plan)
        for (const [related, original] of pairRelatedRows(
          combinedRows(filteredValue, key),
          combinedRows(rawValue, key),
        )) {
          nestedFiltered.push(related)
          nestedRaw.push(original)
        }
      } else if (isRow(filteredValue) && isRow(rawValue)) {
        nestedFiltered.push(filteredValue)
        nestedRaw.push(rawValue)
      }
    }
    if (nestedFiltered.length === 0) continue
    await narrowUnincludedForeignKeys(
      binding,
      nestedFiltered,
      nestedRaw,
      plan,
      ruleViews.nested[plan.relation] ?? NO_RULE_VIEWS,
    )
  }
}

function reduces(plans: readonly IncludePlan[]): boolean {
  return plans.some((plan) => plan.reduce !== undefined || reduces(plan.includes))
}

/**
 * Stand an empty to-many in for every relation the read reduced, so the strip
 * decides whether the key survives on the one path that makes that decision —
 * the relationship field's own `read` rule over a relation's rows — and
 * {@link restoreReductions} writes the reduction back under the keys it kept.
 *
 * A `combine` with a rows branch stands in those rows instead. A relation that
 * is both reduced and a live declared dependency (#1357) stands in the rows its
 * declared branch fetched, so the declaring hook and a `read` rule decide
 * against real rows (ADR-0051, ADR-0082).
 */
function maskReductions(row: OrmRow, plans: readonly IncludePlan[]): OrmRow {
  if (!reduces(plans)) return row
  const masked: OrmRow = { ...row }
  for (const plan of plans) {
    if (plan.reduce !== undefined) {
      const rows = plan.reducedDeclared
        ? declaredRowsOf(row[plan.relation])
        : combinedRows(row[plan.relation], rowsKeyOf(plan))
      masked[plan.relation] = reduces(plan.includes)
        ? rows.map((related) => maskReductions(related, plan.includes))
        : rows
      continue
    }
    if (!reduces(plan.includes)) continue
    const value = masked[plan.relation]
    if (Array.isArray(value)) {
      masked[plan.relation] = value.map((related) =>
        isRow(related) ? maskReductions(related, plan.includes) : related,
      )
    } else if (isRow(value)) {
      masked[plan.relation] = maskReductions(value, plan.includes)
    }
  }
  return masked
}

/** The key a `combine` returned the relation's own rows under, if it named one. */
function rowsKeyOf(plan: IncludePlan): string | undefined {
  if (plan.reduce?.kind !== 'combine') return undefined
  for (const branch of plan.reduce.branches) {
    if (branch.kind === 'rows') return branch.key
  }
  return undefined
}

/** The rows an internal declared-dependency branch fetched (`IncludePlan.declaredRows`). */
function declaredRowsOf(value: unknown): OrmRow[] {
  return combinedRows(value, DECLARED_ROWS_BRANCH_KEY)
}

/** The rows a `combine` returned under {@link rowsKeyOf}, or `[]` for a bare count. */
function combinedRows(value: unknown, key: string | undefined): OrmRow[] {
  if (key === undefined || !isRow(value)) return []
  const rows = value[key]
  return Array.isArray(rows) ? rows.filter(isRow) : []
}

/**
 * The reduction's own value with the internal declared branch spliced back
 * out: a bare count unwrapped from {@link DECLARED_COUNT_BRANCH_KEY}, or a
 * caller's own combine object without {@link DECLARED_ROWS_BRANCH_KEY}.
 */
function publicReductionValue(raw: unknown, reduce: ReducePlan): unknown {
  if (!isRow(raw)) return raw
  if (reduce.kind === 'count') return raw[DECLARED_COUNT_BRANCH_KEY] ?? 0
  const publicValue: Record<string, unknown> = { ...raw }
  delete publicValue[DECLARED_ROWS_BRANCH_KEY]
  return publicValue
}

/** Write each reduced relation back, under the keys Field Visibility kept. */
function restoreReductions(shown: OrmRow, source: OrmRow, plans: readonly IncludePlan[]): void {
  for (const plan of plans) {
    if (plan.reduce !== undefined) {
      if (!(plan.relation in shown)) continue
      const raw = source[plan.relation]
      if (plan.reducedDeclared) {
        shown[plan.relation] = publicReductionValue(raw, plan.reduce)
        continue
      }
      const key = rowsKeyOf(plan)
      if (key === undefined || !isRow(raw)) {
        shown[plan.relation] = raw
        continue
      }
      const kept = shown[plan.relation]
      if (reduces(plan.includes) && Array.isArray(kept)) {
        const rows = combinedRows(raw, key)
        for (const [related, original] of pairRelatedRows(kept, rows)) {
          restoreReductions(related, original, plan.includes)
        }
      }
      const base = publicReductionValue(raw, plan.reduce)
      shown[plan.relation] = { ...(isRow(base) ? base : raw), [key]: kept }
      continue
    }
    if (!reduces(plan.includes)) continue
    const kept = shown[plan.relation]
    const raw = source[plan.relation]
    if (Array.isArray(kept) && Array.isArray(raw)) {
      for (const [related, original] of pairRelatedRows(kept, raw)) {
        restoreReductions(related, original, plan.includes)
      }
    } else if (isRow(kept) && isRow(raw)) {
      restoreReductions(kept, raw, plan.includes)
    }
  }
}

async function unshapedDeclaredRows(
  binding: VisibilityBinding,
  listName: string,
  rows: readonly OrmRow[],
  plans: readonly IncludePlan[],
): Promise<Map<string, Map<string, unknown>>> {
  const byRelation = new Map<string, Map<string, unknown>>()
  for (const plan of plans) {
    if (plan.ruleView !== 'declaredRowsBranch') continue
    const values = new Map<string, unknown>()
    for (const row of rows) values.set(String(row['id']), declaredRowsOf(row[plan.relation]))
    byRelation.set(plan.relation, values)
  }
  const fetched = plans.filter((plan) => plan.ruleView === 'declaredFetch')
  const ids = rows
    .map((row) => row['id'])
    .filter((id): id is RowLockKey => typeof id === 'string' || typeof id === 'number')
  if (fetched.length === 0 || ids.length === 0) return byRelation
  const ops = await whereCombinators()
  for (const plan of fetched) {
    const owners = await engineRead(binding, () =>
      collectionFor(binding.ormHandle, listName)
        .where((model) => identityIn(model, listName, ids))
        .select('id')
        .include(plan.relation, (child) => {
          let scoped = child
          for (const predicate of plan.declaredFetch ?? []) {
            scoped = scoped.where((model) => lowerWhere(predicate, model, ops))
          }
          return scoped
        })
        .all(),
    )
    const values = new Map<string, unknown>()
    for (const owner of owners) values.set(String(owner['id']), owner[plan.relation])
    byRelation.set(plan.relation, values)
  }
  return byRelation
}

async function ruleViewTreeFor(
  binding: VisibilityBinding,
  level: PlanLevel,
  rows: readonly OrmRow[],
): Promise<RuleViewTree> {
  const plans = level.includes
  const unshaped = await unshapedDeclaredRows(binding, level.listName, rows, plans)
  const nested: Record<string, RuleViewTree> = {}
  for (const plan of plans) {
    if (plan.declared || plan.includes.length === 0) continue
    const rowsKey = rowsKeyOf(plan)
    if (plan.reduce !== undefined && rowsKey === undefined) continue
    const children: OrmRow[] = []
    for (const row of rows) {
      const value = row[plan.relation]
      if (plan.reduce !== undefined) children.push(...combinedRows(value, rowsKey))
      else if (Array.isArray(value)) children.push(...value.filter(isRow))
      else if (isRow(value)) children.push(value)
    }
    if (children.length === 0) continue
    nested[plan.relation] = await ruleViewTreeFor(binding, plan, children)
  }
  return { viewFor: (row) => ruleViewFor(row, plans, unshaped), nested }
}

/** A to-one reading `null` for a row the session cannot see. Inverse sides cannot be told apart. */
function isScopedAway(row: OrmRow, plan: IncludePlan, value: unknown): boolean {
  if (plan.arity !== 'one' || value !== null) return false
  return plan.foreignKey === undefined ? plan.accessScoped : row[plan.foreignKey] !== null
}

function ruleViewFor(
  row: OrmRow,
  plans: readonly IncludePlan[],
  unshaped: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
): RuleView {
  const removed = new Set<string>()
  const declared: Record<string, unknown> = {}
  const scopedAway = new Set<string>()
  for (const plan of plans) {
    const values = unshaped.get(plan.relation)
    const rows = values?.get(String(row['id']))
    if (isScopedAway(row, plan, rows ?? row[plan.relation])) scopedAway.add(plan.relation)
    if (rows !== undefined) declared[plan.relation] = rows
    else if (plan.ruleView !== 'fetched') removed.add(plan.relation)
  }
  return { removed, declared, scopedAway }
}
