// The emitted declared-dependency sets, read per list (ADR-0025, ADR-0051).

import type { OpenSaasConfig } from '../config/types.js'
import type { DependencyTable, ListDependencies } from '../contract/dependencies.js'
import { deriveDependencyTable } from '../contract/dependencies.js'

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
