// The caller's projection and the engine's widening of it: which field keys a
// level returns, and which contract columns the query actually asks for. Nothing
// here imports the ORM — the plan meets a collection in `read.ts`. See ADR-0027,
// ADR-0041 and ADR-0051.

import type { FieldConfig } from '../config/types.js'
import { resolveDeclaredDependencies } from '../access/declared-dependencies.js'
import { classifyRowIndependentRead } from '../access/field-access.js'
import {
  resolveListMember,
  resolveListMembers,
  unhandledMember,
  type DeclaredFieldMember,
  type ListMember,
} from '../members/list-members.js'
import { ValidationError } from '../hooks/index.js'
import { memberGate, memberOf, unqueryableKey, type ResolveContext } from './vocabulary.js'

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

function declaredColumns(member: DeclaredFieldMember): readonly string[] {
  const { storage } = member
  switch (storage.kind) {
    case 'column':
      return [member.name]
    case 'columns':
      return storage.parts.map((part) => part.name)
    case 'relation':
      return storage.foreignKey === undefined ? [] : [storage.foreignKey.name]
    case 'computed':
      return []
    default:
      return unhandledMember(storage)
  }
}

/** The contract columns a declared dependency on this member widens the read by. */
function dependencyColumns(member: ListMember): readonly string[] {
  switch (member.kind) {
    case 'field':
      return declaredColumns(member)
    case 'foreignKey':
    case 'partColumn':
    case 'systemField':
      return [member.name]
    case 'syntheticBackRelation':
      return []
    default:
      return unhandledMember(member)
  }
}

/** The contract columns `.select()` projects for `member`, or a refusal. */
function selectedColumns(member: ListMember, ctx: ResolveContext): readonly string[] {
  switch (member.kind) {
    case 'field':
      if (member.storage.kind === 'relation') {
        throw new RelationSelectError(ctx.listName, member.name)
      }
      return declaredColumns(member)
    case 'foreignKey':
    case 'systemField':
      return [member.name]
    case 'partColumn':
    case 'syntheticBackRelation':
      throw unqueryableKey(ctx.listName, member.name)
    default:
      return unhandledMember(member)
  }
}

/**
 * Whether a `read` rule on this field has to see a row to answer. A level
 * carrying one is read at its full width, because a rule that reaches into
 * `item` cannot be answered against a row that was projected away.
 */
export async function readsTheRow(
  fieldConfig: FieldConfig | undefined,
  ctx: ResolveContext,
): Promise<boolean> {
  if (!ctx.checkFieldRead) return false
  if (fieldConfig?.access?.read === undefined) return false
  const answer = await classifyRowIndependentRead(fieldConfig.access, {
    session: ctx.session,
    context: ctx.context,
  })
  return answer === 'row-dependent'
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
 *
 * The relations this level includes are scanned for the same row-dependent
 * `read` rule the selected fields are. Their rules are answered post-query by
 * Field Visibility against the row this level fetched, so a projected-away
 * row would make a relation's visibility a function of the caller's
 * projection — an access decision must not depend on what someone happened to
 * select.
 */
export async function resolveProjection(
  fields: readonly string[] | undefined,
  includeNames: readonly string[],
  ctx: ResolveContext,
): Promise<ProjectionPlan> {
  if (fields === undefined) return UNPROJECTED

  const columns = new Set<string>(resolveListMembers(ctx.config, ctx.listName).systemFields)
  const selected = new Set<string>()
  let rowDependent = false

  for (const name of fields) {
    const member = memberOf(name, ctx)
    for (const column of selectedColumns(member, ctx)) columns.add(column)
    if (await readsTheRow(memberGate(member, ctx), ctx)) rowDependent = true
    selected.add(name)
  }

  for (const name of includeNames) {
    const included = Object.hasOwn(ctx.listConfig.fields, name)
      ? ctx.listConfig.fields[name]
      : undefined
    if (await readsTheRow(included, ctx)) rowDependent = true
  }

  // A declared dependency names a FIELD KEY (`contract/dependencies.ts`), and
  // a field key is not a contract column: a multi-column field owns several
  // and a to-one owns its foreign key. Resolved through the same descriptor
  // the caller's own selection is, so the widening never projects a column
  // the contract does not have.
  for (const name of resolveDeclaredDependencies(ctx.config, ctx.listName, selected).columns) {
    const member = resolveListMember(ctx.config, ctx.listName, name)
    if (member === undefined) continue
    for (const column of dependencyColumns(member)) columns.add(column)
  }

  return {
    columns: rowDependent ? undefined : [...columns],
    caller: new Set([...selected, ...includeNames]),
  }
}
