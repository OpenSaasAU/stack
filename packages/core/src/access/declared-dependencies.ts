import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import type { DependencyTable, ListDependencies } from '../contract/dependencies.js'
import { deriveDependencyTable } from '../contract/dependencies.js'
import { getRelatedListConfig } from './engine.js'

/**
 * Declared Dependencies — widening a read for the `needs` of the computed
 * fields it is about to return, without widening what the caller receives
 * (ADR-0025, ADR-0051).
 *
 * The sets are an emitted fact, not a walk: `pnpm generate` resolves every
 * `(list, field)` into its one-hop set and the generated context hands the
 * table to the runtime through `config._tables`. A config reached without
 * generation — a test, a tool — gets the same table from the same
 * computation, memoised per config rather than recomputed per read.
 *
 * The set is one hop and non-transitive. A branch added purely to satisfy a
 * declaration delivers its rows' stored columns and nothing else: no computed
 * field runs on it, so nothing on it declares anything, so the widening never
 * recurses. Recursion is therefore bounded by the caller's own finite
 * `include` literal, and the `visitedLists` cycle guard the recursive fold
 * needed is deleted along with `validateNeedsClosureDepth` (ADR-0051).
 *
 * A branch the caller named IS returned, so ADR-0027 has its
 * computed fields run and this module widens at that level too — which is why
 * it still descends into caller-named keys.
 *
 * A declared column needs no widening: every read already carries the row's
 * stored columns, and `field-visibility.ts` keeps a declared one on the hook's
 * `item` when the caller's projection left it out.
 */

/**
 * The relation keys, at each nesting level, that only the widening added.
 * `field-visibility.ts` strips them from the result once `resolveOutput` has
 * had its chance to read them — a declared dependency is private plumbing,
 * not an implicit `include`.
 */
export type DependencyAdditions = {
  /** Keys at THIS level whose entire branch the widening added. */
  keys: Set<string>
  /** Per-key additions beneath a relation the caller named for its own reasons. */
  nested: Record<string, DependencyAdditions>
}

/**
 * Which field names a level of a read is going to return, and the same tree
 * one level down for every relation it reaches. `fields: undefined` means
 * unrestricted — what a read that named no projection at that level means.
 *
 * It is what makes computation projection-aware (ADR-0027): a field a level
 * does not return is never computed, its read access is never evaluated and
 * its declared dependencies are never fetched. It is also the caller half of
 * the widen-and-strip difference (ADR-0041) — anything the engine added for
 * its own reasons is outside it, and Field Visibility strips it back out.
 */
export type FieldSelectionScope = {
  readonly fields: ReadonlySet<string> | undefined
  readonly nested: Readonly<Record<string, FieldSelectionScope>>
}

export function noDependencyAdditions(): DependencyAdditions {
  return { keys: new Set(), nested: {} }
}

function isEmpty(additions: DependencyAdditions): boolean {
  return additions.keys.size === 0 && Object.keys(additions.nested).length === 0
}

function isRelationshipFieldConfig(
  fieldConfig: FieldConfig | undefined,
): fieldConfig is FieldConfig & { type: 'relationship'; ref: string } {
  return (
    !!fieldConfig &&
    fieldConfig.type === 'relationship' &&
    'ref' in fieldConfig &&
    !!fieldConfig.ref
  )
}

/** A plain object — excludes `null` and arrays, which `typeof x === 'object'` alone would admit. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The explicit nested `include` on an include entry, if the entry is a structured object naming one. */
function getExplicitInclude(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined
  const { include } = value
  return isPlainObject(include) ? include : undefined
}

const derived = new WeakMap<OpenSaasConfig, DependencyTable>()

/** The table `config` derives, computed once and memoised rather than per read. */
function deriveOnce(config: OpenSaasConfig): DependencyTable {
  const cached = derived.get(config)
  if (cached) return cached
  const table = deriveDependencyTable(config)
  derived.set(config, table)
  return table
}

/**
 * The dependency-set table for `config`: the one `pnpm generate` emitted when
 * the generated context supplied it, otherwise the same computation.
 */
export function getDependencyTable(config: OpenSaasConfig): DependencyTable {
  return config._tables?.dependencies ?? deriveOnce(config)
}

const EMPTY_LIST_DEPENDENCIES: ListDependencies = { systemFields: ['id'], fields: {} }

/**
 * One list's row in the table.
 *
 * A list the emitted table does not describe is a bundle older than the config
 * — a list added without regenerating. Answering with an empty row would be
 * silently wrong in two directions at once: the list's declared columns would
 * stop reaching their hooks, and its timestamps would stop being exempt from
 * field access. So the row is derived from the config instead. The emitted
 * table stays authoritative everywhere it speaks, and a stale one degrades to
 * the behaviour that predated emission rather than to silence.
 *
 * The `id`-only row survives for a list key the config does not have either,
 * where there is genuinely nothing to say.
 */
export function getListDependencies(config: OpenSaasConfig, listKey: string): ListDependencies {
  return (
    getDependencyTable(config)[listKey] ?? deriveOnce(config)[listKey] ?? EMPTY_LIST_DEPENDENCIES
  )
}

/**
 * The union of the dependency sets of the computed fields this read will
 * return (ADR-0027). `selectedFields`, when given, is the read's own
 * projection — a field it did not select is never computed, so its
 * declarations are not paid for. `undefined` means unrestricted, matching a
 * read that named no projection, which returns every computed field.
 */
export function resolveDeclaredDependencies(
  config: OpenSaasConfig,
  listKey: string,
  selectedFields?: ReadonlySet<string>,
): { columns: Set<string>; relations: Set<string> } {
  const columns = new Set<string>()
  const relations = new Set<string>()

  for (const [fieldKey, set] of Object.entries(getListDependencies(config, listKey).fields)) {
    if (selectedFields && !selectedFields.has(fieldKey)) continue
    for (const column of set.columns) columns.add(column)
    for (const relation of set.relations) relations.add(relation)
  }

  return { columns, relations }
}

/**
 * Widen `rawInclude` with the declared relations of the computed fields this
 * read returns, and report which keys the widening added so they can be
 * stripped afterwards.
 *
 * Returns `rawInclude` itself (same reference) when there is nothing to
 * widen, so a list with no declarations and no caller include stays on the
 * exact bare-read path (ADR-0024) — untouched, not merely equivalent. A list
 * whose declarations name columns alone stays there too: a column is already
 * on the row.
 */
export function widenIncludeForDependencies(
  rawInclude: Record<string, unknown> | undefined,
  fieldConfigs: Record<string, FieldConfig>,
  config: OpenSaasConfig,
  listKey: string,
  selection?: FieldSelectionScope,
): { include: Record<string, unknown> | undefined; additions: DependencyAdditions } {
  const declared = [
    ...resolveDeclaredDependencies(config, listKey, selection?.fields).relations,
  ].filter((name) => isRelationshipFieldConfig(fieldConfigs[name]))

  if (declared.length === 0 && !rawInclude) {
    return { include: rawInclude, additions: noDependencyAdditions() }
  }

  const additions = noDependencyAdditions()
  const merged: Record<string, unknown> = { ...(rawInclude ?? {}) }

  for (const name of declared) {
    if (name in merged) continue // the caller asked for it — not an addition
    merged[name] = true
    additions.keys.add(name)
  }

  for (const [key, value] of Object.entries(merged)) {
    // A branch the widening added carries no caller include of its own and
    // returns to nobody, so nothing on it computes and nothing on it declares
    // (ADR-0051). Only the caller's own tree descends.
    if (additions.keys.has(key)) continue

    const fieldConfig = fieldConfigs[key]
    if (!isRelationshipFieldConfig(fieldConfig)) continue

    const relatedConfig = getRelatedListConfig(fieldConfig.ref, config)
    if (!relatedConfig) continue

    const nested = widenIncludeForDependencies(
      getExplicitInclude(value),
      relatedConfig.listConfig.fields,
      config,
      relatedConfig.listName,
      selection?.nested[key],
    )

    if (nested.include) {
      merged[key] = {
        ...(typeof value === 'object' && value ? value : {}),
        include: nested.include,
      }
    }

    if (!isEmpty(nested.additions)) {
      additions.nested[key] = nested.additions
    }
  }

  return { include: merged, additions }
}
