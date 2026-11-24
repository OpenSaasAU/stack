// Field Visibility: raw rows and a resolved plan in, the rows a caller may see out,
// for every read terminal and every write return (ADR-0027, ADR-0044, ADR-0051).

import type { AccessContext, OrmRow } from '../access/types.js'
import type { FieldConfig, ListConfig, TypeInfo } from '../config/types.js'
import { isComputedField } from '../config/field-kind.js'
import { checkRowRead } from '../access/field-access.js'
import {
  NO_RULE_VIEWS,
  ruleRowOf,
  type RuleRow,
  type RuleView,
  type RuleViews,
} from '../access/rule-item.js'
import { RESOLVE_CHAIN_MAX_LENGTH } from '../access/depth-limits.js'
import { ResolveOutputCycleError } from '../access/errors.js'
import { withDerivedSessionVocabulary } from '../access/session-vocabulary.js'
import { getListDependencies } from '../access/declared-dependencies.js'
import {
  partColumnsOf,
  resolveListMembers,
  unhandledMember,
  type ListMember,
  type ListMembers,
} from '../members/list-members.js'
import { lowerWhere, whereCombinators } from './lower.js'
import { resolveRelatedAccessPlan, type ResolveContext } from './vocabulary.js'
import {
  DECLARED_COUNT_BRANCH_KEY,
  DECLARED_ROWS_BRANCH_KEY,
  type IncludePlan,
  type PlanLevel,
  rowsBranchKeyOf,
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
 * The batch is what lets the foreign-key pass resolve a
 * to-one this read never named at all for a whole page in one query per
 * relation rather than one per row.
 */
export async function visibleRows(
  binding: VisibilityBinding,
  rows: readonly OrmRow[],
  root: PlanLevel,
): Promise<VisibleRow[]> {
  return minted(await traverse(binding, rows, root))
}

interface VisitedRow {
  readonly raw: OrmRow
  readonly shown: OrmRow
  readonly related: ReadonlyMap<string, readonly VisitedRow[]>
}

/** The rule views of one read, by the plan level whose rows they describe. */
type ReadViews = ReadonlyMap<PlanLevel, RuleViews>

/**
 * One pass over the plan: the unshaped declared rows each level's rules and
 * hooks are owed, then each row's rule view, field strip, computed fields,
 * reductions and included foreign keys in one visit per node, then each
 * node's un-included foreign keys across every row that reached it.
 */
async function traverse(
  binding: VisibilityBinding,
  rows: readonly OrmRow[],
  root: PlanLevel,
): Promise<OrmRow[]> {
  const views = new Map<PlanLevel, RuleViews>()
  await collectRuleViews(binding, root, rows, views)
  const visited = await Promise.all(
    rows.map((row) => visitRow(binding, row, ruleFacingRow(row, root), root, views)),
  )
  if (binding.context._isSudo !== true) await narrowForeignKeysAt(binding, visited, root, views)
  return visited.map((row) => row.shown)
}

function viewsOf(level: PlanLevel, views: ReadViews): RuleViews {
  return views.get(level) ?? NO_RULE_VIEWS
}

/**
 * A reduction's value, read here and nowhere else on the traversal: the rows
 * of the caller's rows branch, the rows the declaring hooks are owed, what
 * stands in for the value where a rule, a hook or the visit reads rows, and
 * what the caller receives.
 */
interface Reduction {
  readonly rowsKey: string | undefined
  readonly rows: (value: unknown) => OrmRow[]
  readonly declaredRows: (value: unknown) => OrmRow[]
  readonly standIn: (value: unknown) => OrmRow[]
  readonly shown: (value: unknown, kept: readonly OrmRow[]) => unknown
}

const reductionByNode = new WeakMap<IncludePlan, Reduction | undefined>()

function reductionOf(node: IncludePlan): Reduction | undefined {
  if (reductionByNode.has(node)) return reductionByNode.get(node)
  const reduction = buildReduction(node)
  reductionByNode.set(node, reduction)
  return reduction
}

function buildReduction(node: IncludePlan): Reduction | undefined {
  const reduce = node.reduce
  if (reduce === undefined) return undefined
  const rowsKey = rowsBranchKeyOf(reduce)
  const branchRows = (value: unknown, key: string | undefined): OrmRow[] => {
    if (key === undefined || !isRow(value)) return []
    const rows = value[key]
    return Array.isArray(rows) ? rows.filter(isRow) : []
  }
  const withoutDeclared = (value: OrmRow): unknown => {
    if (reduce.kind === 'count') return value[DECLARED_COUNT_BRANCH_KEY] ?? 0
    const publicValue: Record<string, unknown> = { ...value }
    delete publicValue[DECLARED_ROWS_BRANCH_KEY]
    return publicValue
  }
  const declaredRows = (value: unknown): OrmRow[] => branchRows(value, DECLARED_ROWS_BRANCH_KEY)
  const rows = (value: unknown): OrmRow[] => branchRows(value, rowsKey)
  return {
    rowsKey,
    rows,
    declaredRows,
    standIn: node.reducedDeclared ? declaredRows : rows,
    shown: (value, kept) => {
      if (!isRow(value)) return value
      if (node.reducedDeclared) return withoutDeclared(value)
      if (rowsKey === undefined) return value
      const base = withoutDeclared(value)
      return { ...(isRow(base) ? base : value), [rowsKey]: kept }
    },
  }
}

const reducesBeneathByLevel = new WeakMap<PlanLevel, boolean>()

function reducesBeneath(level: PlanLevel): boolean {
  const known = reducesBeneathByLevel.get(level)
  if (known !== undefined) return known
  const found = level.includes.some((node) => node.reduce !== undefined || reducesBeneath(node))
  reducesBeneathByLevel.set(level, found)
  return found
}

/** One row as its level's rules and hooks read it: each reduced relation as the rows standing in for it. */
function ruleFacingRow(row: OrmRow, level: PlanLevel): OrmRow {
  if (!reducesBeneath(level)) return row
  const facing: OrmRow = { ...row }
  for (const node of level.includes) {
    const reduction = reductionOf(node)
    if (reduction !== undefined) {
      const rows = reduction.standIn(row[node.relation])
      facing[node.relation] = reducesBeneath(node)
        ? rows.map((related) => ruleFacingRow(related, node))
        : rows
      continue
    }
    if (!reducesBeneath(node)) continue
    const value = facing[node.relation]
    if (Array.isArray(value)) {
      facing[node.relation] = value.map((related) =>
        isRow(related) ? ruleFacingRow(related, node) : related,
      )
    } else if (isRow(value)) {
      facing[node.relation] = ruleFacingRow(value, node)
    }
  }
  return facing
}

/**
 * The rule views of every level the read reaches, each built over every row
 * that reached it, fetching a caller-shaped declared relation's unshaped rows
 * before any rule or hook runs.
 */
async function collectRuleViews(
  binding: VisibilityBinding,
  level: PlanLevel,
  rows: readonly OrmRow[],
  views: Map<PlanLevel, RuleViews>,
): Promise<void> {
  const unshaped = await unshapedRowsAt(binding, level, rows)
  for (const node of level.includes) {
    if (node.declared || node.includes.length === 0) continue
    const reduction = reductionOf(node)
    if (reduction !== undefined && reduction.rowsKey === undefined) continue
    const children: OrmRow[] = []
    for (const row of rows) {
      const value = row[node.relation]
      if (reduction !== undefined) children.push(...reduction.rows(value))
      else if (Array.isArray(value)) children.push(...value.filter(isRow))
      else if (isRow(value)) children.push(value)
    }
    if (children.length === 0) continue
    await collectRuleViews(binding, node, children, views)
  }
  views.set(level, { viewFor: (row) => ruleViewFor(row, level.includes, unshaped) })
}

/** The declared rows each relation's rules and hooks see in place of the caller's, by owner id. */
async function unshapedRowsAt(
  binding: VisibilityBinding,
  level: PlanLevel,
  rows: readonly OrmRow[],
): Promise<Map<string, Map<string, unknown>>> {
  const { listName } = level
  const byRelation = new Map<string, Map<string, unknown>>()
  for (const node of level.includes) {
    const reduction = reductionOf(node)
    if (node.ruleView !== 'declaredRowsBranch' || reduction === undefined) continue
    const values = new Map<string, unknown>()
    for (const row of rows)
      values.set(String(row['id']), reduction.declaredRows(row[node.relation]))
    byRelation.set(node.relation, values)
  }
  const fetched = level.includes.filter((node) => node.ruleView === 'declaredFetch')
  const ids = rows.map((row) => row['id']).filter(isRowLockKey)
  if (fetched.length === 0 || ids.length === 0) return byRelation
  const ops = await whereCombinators()
  for (const node of fetched) {
    const owners = await engineRead(binding, () =>
      collectionFor(binding.ormHandle, listName)
        .where((model) => identityIn(model, listName, ids))
        .select('id')
        .include(node.relation, (child) => {
          let scoped = child
          for (const predicate of node.declaredFetch ?? []) {
            scoped = scoped.where((model) => lowerWhere(predicate, model, ops))
          }
          return scoped
        })
        .all(),
    )
    const values = new Map<string, unknown>()
    for (const owner of owners) values.set(String(owner['id']), owner[node.relation])
    byRelation.set(node.relation, values)
  }
  return byRelation
}

/**
 * Each related row a relation's value carries, paired with the raw row it was
 * read from: the same row unless a reduction beneath it stands rows in.
 */
function relatedPairs(
  facingValue: unknown,
  rawValue: unknown,
  reduction: Reduction | undefined,
): [OrmRow, OrmRow][] {
  const facing: readonly unknown[] = Array.isArray(facingValue) ? facingValue : [facingValue]
  const raw: readonly unknown[] =
    reduction !== undefined
      ? reduction.standIn(rawValue)
      : Array.isArray(rawValue)
        ? rawValue
        : [rawValue]
  const pairs: [OrmRow, OrmRow][] = []
  facing.forEach((related, index) => {
    if (!isRow(related)) return
    const original = raw[index]
    pairs.push([related, isRow(original) ? original : related])
  })
  return pairs
}

async function visitRow(
  binding: VisibilityBinding,
  raw: OrmRow,
  facing: OrmRow,
  level: PlanLevel,
  views: ReadViews,
): Promise<VisitedRow> {
  const { config } = binding
  const { listName: listKey, selection } = level
  const fieldConfigs = level.listConfig.fields
  const args: FieldVisibilityArgs = { session: binding.context.session, context: binding.context }
  const members = resolveListMembers(config, listKey)
  const declaredDependencies = getListDependencies(config, listKey).fields
  const systemFields = new Set<string>(members.systemFields)

  const assembled = assembleColumnFields(facing, fieldConfigs, members)
  const ruleRow = ruleRowOf(assembled, viewsOf(level, views), fieldConfigs, config, listKey)
  const hookItemFor = (fieldName: string): Record<string, unknown> => {
    const declared = Object.hasOwn(declaredDependencies, fieldName)
      ? declaredDependencies[fieldName]
      : { columns: [], relations: [] }
    const hookItem: Record<string, unknown> = {}
    for (const key of [...systemFields, ...declared.columns, ...declared.relations]) {
      if (key in ruleRow.item) hookItem[key] = ruleRow.item[key]
    }
    return hookItem
  }
  const selected = (fieldName: string): boolean =>
    selection === undefined || selection.has(fieldName)
  const resolve = (fieldName: string, value: unknown) =>
    resolveReadableFieldValue({
      fieldConfig: fieldConfigs[fieldName],
      fieldName,
      value,
      ruleRow,
      hookItem: hookItemFor(fieldName),
      listKey,
      args,
      binding,
    })
  let ownerReads: Map<string, boolean> | undefined

  const nodes = nodesOf(level)
  const shown: OrmRow = {}
  const related = new Map<string, readonly VisitedRow[]>()
  for (const [fieldName, value] of Object.entries(assembled)) {
    if (systemFields.has(fieldName)) {
      shown[fieldName] = value
      continue
    }
    if (!selected(fieldName)) continue
    const member = members.members.get(fieldName)
    if (member?.kind === 'partColumn') {
      ownerReads ??= new Map()
      let readable = ownerReads.get(member.field)
      if (readable === undefined) {
        readable = await checkRowRead(fieldConfigs[member.field]?.access, args, ruleRow)
        ownerReads.set(member.field, readable)
      }
      if (readable) shown[fieldName] = value
      continue
    }
    const node = nodes.get(fieldName)
    if (node === undefined && member !== undefined && isRelationMember(member)) continue

    if (node !== undefined && value !== null && value !== undefined) {
      const reduction = reductionOf(node)
      const reached = relatedPairs(value, raw[fieldName], reduction)
      let kept = reached
      if (node.synthetic === undefined) {
        if (!(await checkRowRead(fieldConfigs[fieldName]?.access, args, ruleRow))) continue
        if (node.declared) continue
        if (reduction !== undefined && node.reducedDeclared) {
          shown[fieldName] = reduction.shown(raw[fieldName], [])
          continue
        }
      } else {
        const gate = node.synthetic.gate
        const allowed = await Promise.all(
          reached.map(([relatedRow]) =>
            checkRowRead(
              gate.access,
              args,
              ruleRowOf(
                relatedRow,
                viewsOf(node, views),
                node.listConfig.fields,
                config,
                node.listName,
              ),
            ),
          ),
        )
        kept = reached.filter((_, index) => allowed[index])
      }
      if (reduction !== undefined || Array.isArray(value)) {
        const rows = await Promise.all(
          kept.map(([relatedRow, original]) =>
            visitRow(binding, original, relatedRow, node, views),
          ),
        )
        const shownRows = rows.map((row) => row.shown)
        if (reduction === undefined) {
          shown[fieldName] = shownRows
          related.set(fieldName, rows)
        } else {
          shown[fieldName] = reduction.shown(raw[fieldName], shownRows)
          if (reduction.rowsKey !== undefined) related.set(fieldName, rows)
        }
      } else if (kept.length > 0) {
        const [relatedRow, original] = kept[0]
        const row = await visitRow(binding, original, relatedRow, node, views)
        shown[fieldName] = row.shown
        related.set(fieldName, [row])
      } else if (reached.length > 0) {
        shown[fieldName] = null
      }
      continue
    }

    const result = await resolve(fieldName, value)
    if (result.readable) shown[fieldName] = result.value
  }
  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    if (fieldName in shown || !selected(fieldName) || !fieldConfig.hooks?.resolveOutput) continue
    if (!isComputedField(fieldConfig, fieldName, listKey, config)) continue
    const result = await resolve(fieldName, undefined)
    if (result.readable) shown[fieldName] = result.value
  }
  for (const node of level.includes) {
    if (node.declared) delete shown[node.relation]
  }
  narrowIncludedForeignKeys(shown, level.includes)
  return { raw, shown, related }
}

/**
 * Narrow each foreign-key column the level did not include to what the caller
 * may see: the owning field's own `read` rule per row, and the related list's
 * own `query` access, with one batched existence query per owner whose access
 * is a filter; then the same for every level beneath it, across the rows that
 * reached it.
 */
async function narrowForeignKeysAt(
  binding: VisibilityBinding,
  rows: readonly VisitedRow[],
  level: PlanLevel,
  views: ReadViews,
): Promise<void> {
  const { listName, listConfig } = level
  const ctx = relatedResolveContext(binding, level)
  const args = { session: binding.context.session, context: binding.context }
  const members = level.foreignKeys().owned
    ? resolveListMembers(binding.config, listName)
    : undefined
  const ruleRows =
    members === undefined
      ? []
      : rows.map((row) =>
          ruleRowOf(
            assembleColumnFields(ruleFacingRow(row.raw, level), listConfig.fields, members),
            viewsOf(level, views),
            listConfig.fields,
            binding.config,
            listName,
          ),
        )

  for (const owner of level.foreignKeys().unincluded) {
    const column = owner.foreignKey
    const carrying = rows.filter((row) => column in row.raw && column in row.shown)
    if (!rows.some(({ raw }) => column in raw)) continue

    const access = await resolveRelatedAccessPlan(owner.related, ctx)
    for (const [index, row] of rows.entries()) {
      if (!(column in row.raw && column in row.shown)) continue
      const canReadField = await checkRowRead(owner.fieldConfig.access, args, ruleRows[index])
      if (!canReadField || access.kind === 'false') row.shown[column] = null
    }
    if (access.kind === 'true' || access.kind === 'false') continue

    const referenced = new Map<string, RowLockKey>()
    for (const row of carrying) {
      const value = row.raw[column]
      if (row.shown[column] === null || value === null || value === undefined) continue
      if (!isRowLockKey(value)) {
        throw new Error(
          `Foreign key ${listName}.${column} holds a ${typeof value}; Field Visibility narrows only a string or number id.`,
        )
      }
      referenced.set(String(value), value)
    }
    if (referenced.size === 0) continue

    const ops = await whereCombinators()
    const relatedList = owner.related.listName
    const visible = await engineRead(binding, () =>
      collectionFor(binding.ormHandle, relatedList)
        .where((model) => lowerWhere(access, model, ops))
        .where((model) => identityIn(model, relatedList, [...referenced.values()]))
        .select('id')
        .all(),
    )
    const visibleIds = new Set(visible.map((relatedRow) => String(relatedRow.id)))
    for (const row of carrying) {
      const value = row.raw[column]
      if (row.shown[column] === null || value === null || value === undefined) continue
      if (!visibleIds.has(String(value))) row.shown[column] = null
    }
  }

  for (const node of level.includes) {
    const reached = rows.flatMap((row) => row.related.get(node.relation) ?? [])
    if (reached.length > 0) await narrowForeignKeysAt(binding, reached, node, views)
  }
}

/**
 * Set the foreign-key column of each included to-one on one shown row to the
 * related row's id, or `null` when the relation is not visible (ADR-0058),
 * without descending: the rows beneath were set on their own visit. A relation
 * the caller's own `where()` refined is left to the foreign-key pass.
 */
function narrowIncludedForeignKeys(row: OrmRow, plans: readonly IncludePlan[]): void {
  for (const plan of plans) {
    if (plan.declared || plan.arity !== 'one' || plan.foreignKey === undefined) continue
    if (!(plan.foreignKey in row)) continue
    const value = row[plan.relation]
    if (isRow(value)) row[plan.foreignKey] = value.id
    else if (!plan.callerRefined) row[plan.foreignKey] = null
  }
}

function isRowLockKey(value: unknown): value is RowLockKey {
  return typeof value === 'string' || typeof value === 'number'
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

const nodesByLevel = new WeakMap<PlanLevel, ReadonlyMap<string, IncludePlan>>()

function nodesOf(level: PlanLevel): ReadonlyMap<string, IncludePlan> {
  const known = nodesByLevel.get(level)
  if (known !== undefined) return known
  const nodes = new Map(level.includes.map((plan) => [plan.relation, plan]))
  nodesByLevel.set(level, nodes)
  return nodes
}

function isRelationMember(member: ListMember): boolean {
  switch (member.kind) {
    case 'field':
      return member.storage.kind === 'relation'
    case 'syntheticBackRelation':
      return true
    case 'foreignKey':
    case 'partColumn':
    case 'systemField':
      return false
    default:
      return unhandledMember(member)
  }
}

function isRow(value: unknown): value is OrmRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

/** A multi-column field's parts never leak: its value is assembled under its own key (ADR-0006). */
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
