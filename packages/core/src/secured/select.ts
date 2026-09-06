// The caller's projection and the engine's widening of it: which field keys a
// level returns, which contract columns the query actually asks for, and the
// trees Field Visibility needs to strip the difference back out. Nothing here
// imports the ORM — the plan meets a collection in `read.ts`. See ADR-0027,
// ADR-0041 and ADR-0051.

import type { FieldConfig } from '../config/types.js'
import type { DependencyAdditions, FieldSelectionScope } from '../access/declared-dependencies.js'
import {
  getListDependencies,
  resolveDeclaredDependencies,
} from '../access/declared-dependencies.js'
import { classifyRowIndependentRead } from '../access/field-access.js'
import { resolveQueryField } from '../access/query-validation.js'
import { ValidationError } from '../hooks/index.js'
import { unqueryableKey, type ResolveContext } from './vocabulary.js'
import type { IncludePlan } from './include.js'

/**
 * Thrown when `.select()` names a relationship field. The ORM's own
 * projection narrows scalar columns and leaves included relations alone, and
 * the secured surface keeps that split: a relation arrives because a read
 * named it with `.include()`, which is the only spelling that can carry the
 * related list's own scoping.
 */
export class RelationSelectError extends ValidationError {
  constructor(
    readonly listName: string,
    readonly field: string,
  ) {
    super([
      `Cannot select "${listName}.${field}": it is a relation, and select() narrows this list's ` +
        `own columns. Reach it with include("${field}") instead — select() leaves included ` +
        `relations on the row.`,
    ])
    this.name = 'RelationSelectError'
  }
}

/** One level's projection: what the query asks for, and what the caller may keep. */
export interface ProjectionPlan {
  /**
   * The contract column names the query projects to, or `undefined` for the
   * row's full width. Already widened — it carries the list's system fields,
   * the declared dependency sets of the computed fields this level returns,
   * and, where a `read` rule has to see a row to answer, everything.
   */
  readonly columns: readonly string[] | undefined
  /**
   * The field keys this level may return, or `undefined` when the caller
   * selected nothing and every key is theirs. Anything the widening added is
   * outside this set, which is what makes the strip a set difference.
   */
  readonly caller: ReadonlySet<string> | undefined
}

/** A level with no `.select()`: the full row, and nothing to strip. */
export const UNPROJECTED: ProjectionPlan = { columns: undefined, caller: undefined }

/**
 * The contract columns one field contributes, asked of the field itself
 * rather than re-derived from its name: a multi-column field owns several,
 * a to-one owns its foreign key on the side that holds it, and a computed
 * field owns none.
 */
function contractColumns(
  fieldName: string,
  fieldConfig: FieldConfig,
  ctx: ResolveContext,
): readonly string[] {
  const descriptor = fieldConfig.getContractField?.(fieldName, ctx.listName, ctx.config)
  if (descriptor === undefined) return [fieldName]
  if (descriptor.kind === 'column') return [descriptor.name]
  if (descriptor.kind === 'columns') return descriptor.columns.map((column) => column.name)
  if (descriptor.kind === 'relation') {
    return descriptor.foreignKey ? [descriptor.foreignKey.name] : []
  }
  return []
}

/**
 * Resolve one level's `.select()` into the projection the query runs with.
 *
 * The widening has two reasons, both of them the engine's rather than the
 * caller's (ADR-0041): the declared dependency sets of the computed fields
 * this level is going to return (ADR-0051), and field-access resolution — a
 * `read` rule that reaches into `item` cannot be answered against a row that
 * was projected away, so a level carrying one is read at full width. Neither
 * widens what the caller receives: `caller` stays exactly what they named,
 * and the difference is stripped by Field Visibility.
 *
 * An include is not narrowed by `select()` — the ORM's own rule, and the only
 * one under which `select()` and `include()` compose rather than compete — so
 * every relation this level names stays in `caller`.
 */
export async function resolveProjection(
  fields: readonly string[] | undefined,
  includeNames: readonly string[],
  ctx: ResolveContext,
): Promise<ProjectionPlan> {
  if (fields === undefined) return UNPROJECTED

  const selected = new Set<string>()
  for (const name of fields) {
    const resolved = resolveQueryField(name, ctx.listConfig.fields)
    if (resolved === undefined) throw unqueryableKey(ctx.listName, name)
    if (resolved.isRelationship) throw new RelationSelectError(ctx.listName, name)
    selected.add(name)
  }

  const columns = new Set<string>(getListDependencies(ctx.config, ctx.listName).systemFields)
  let rowDependent = false

  for (const name of selected) {
    const fieldConfig = ctx.listConfig.fields[name]
    if (fieldConfig === undefined) continue
    for (const column of contractColumns(name, fieldConfig, ctx)) columns.add(column)
    if (!ctx.checkFieldRead || fieldConfig.access?.read === undefined) continue
    const answer = await classifyRowIndependentRead(fieldConfig.access, {
      session: ctx.session,
      context: ctx.context,
    })
    if (answer === 'row-dependent') rowDependent = true
  }

  for (const column of resolveDeclaredDependencies(ctx.config, ctx.listName, selected).columns) {
    columns.add(column)
  }

  return {
    columns: rowDependent ? undefined : [...columns],
    caller: new Set([...selected, ...includeNames]),
  }
}

/**
 * The relation keys the widening added, level by level. Field Visibility
 * strips them once the declaring hooks have read them, so a declared
 * dependency stays plumbing rather than becoming an implicit include.
 */
export function dependencyAdditions(includes: readonly IncludePlan[]): DependencyAdditions {
  const keys = new Set<string>()
  const nested: Record<string, DependencyAdditions> = {}
  for (const plan of includes) {
    if (plan.declared) {
      keys.add(plan.relation)
      continue
    }
    const below = dependencyAdditions(plan.includes)
    if (below.keys.size > 0 || Object.keys(below.nested).length > 0) {
      nested[plan.relation] = below
    }
  }
  return { keys, nested }
}

/**
 * The caller's projection as Field Visibility reads it, or `undefined` when
 * no level restricted anything — which keeps a read with no `.select()`
 * anywhere on exactly the unprojected path rather than on an equivalent one.
 */
export function selectionScope(
  projection: ProjectionPlan,
  includes: readonly IncludePlan[],
): FieldSelectionScope | undefined {
  const nested: Record<string, FieldSelectionScope> = {}
  for (const plan of includes) {
    if (plan.declared) continue
    const below = selectionScope(plan.projection, plan.includes)
    if (below) nested[plan.relation] = below
  }
  if (projection.caller === undefined && Object.keys(nested).length === 0) return undefined
  return { fields: projection.caller, nested }
}
