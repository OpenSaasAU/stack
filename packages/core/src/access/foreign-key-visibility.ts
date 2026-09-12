import type { Session, AccessContext } from './types.js'
import type { FieldConfig, OpenSaasConfig, RelationshipField } from '../config/types.js'
import { checkAccess, getRelatedListConfig } from './engine.js'
import { checkFieldAccess } from './field-access.js'
import { ormModel } from './orm-client.js'
import { shouldHaveForeignKey } from '../fields/index.js'

/**
 * One to-one relationship field's foreign-key column, resolved against a read
 * that never named the relation — the legacy-surface counterpart of
 * `narrowUnincludedForeignKeys` in `secured/read.ts` (issue #1243).
 *
 * `buildAccessScopedInclude`/`resolveToOneAccessVisibility` only ever resolve
 * a relation present in the caller's own `include`, so a to-one nobody asked
 * for has no entry in `ToOneAccessFilterTree` for `filterReadableFields`'s
 * existing forced-null pass to act on — yet the raw `<field>Id` column is on
 * the row regardless (ADR-0043). `resolveForeignKeyVisibility` (below) closes
 * that gap at the ROOT level of one `filterReadableFields` call, the same
 * scope its own recursive relation calls already cover for nested levels via
 * their own `filterReadableFields`/access-filter calls one hop out — a
 * relation reached only through `include` gets its OWN un-included to-ones
 * narrowed only if the caller resolves this again for that related list, the
 * same way `buildAccessScopedInclude` is already called once per level.
 */
export type ForeignKeyVisibility =
  { kind: 'open' } | { kind: 'denied' } | { kind: 'scoped'; ids: ReadonlySet<string> }

/** Foreign-key column name (`<field>Id`) → its resolved visibility. */
export type ForeignKeyVisibilityMap = Readonly<Record<string, ForeignKeyVisibility>>

export function emptyForeignKeyVisibilityMap(): ForeignKeyVisibilityMap {
  return {}
}

/** Whether `fieldConfig`'s side of a to-one relationship owns a `<field>Id` column at all. */
function ownsForeignKeyColumn(
  fieldName: string,
  fieldConfig: RelationshipField,
  listKey: string,
  config: OpenSaasConfig,
): boolean {
  try {
    return shouldHaveForeignKey(listKey, fieldName, fieldConfig, config)
  } catch {
    return true
  }
}

/**
 * Every to-one relationship field on `fieldConfigs` that owns a foreign-key
 * column and was NOT named in `requestedInclude` — the set
 * `resolveForeignKeyVisibility` resolves.
 */
function unincludedForeignKeyOwners(
  fieldConfigs: Record<string, FieldConfig>,
  requestedInclude: Record<string, unknown>,
  listKey: string,
  config: OpenSaasConfig,
): { fieldName: string; fieldConfig: FieldConfig; ref: string; column: string }[] {
  const owners: { fieldName: string; fieldConfig: FieldConfig; ref: string; column: string }[] = []
  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    if (fieldConfig.type !== 'relationship' || !('ref' in fieldConfig) || !fieldConfig.ref) continue
    if ('many' in fieldConfig && fieldConfig.many === true) continue
    if (requestedInclude[fieldName]) continue
    if (
      !ownsForeignKeyColumn(fieldName, fieldConfig as unknown as RelationshipField, listKey, config)
    ) {
      continue
    }
    owners.push({
      fieldName,
      fieldConfig,
      ref: fieldConfig.ref as string,
      column: `${fieldName}Id`,
    })
  }
  return owners
}

/**
 * Resolve the foreign-key visibility of every to-one relationship field
 * `requestedInclude` did not name, across the whole batch of `items` — one
 * batched existence check per relation, keyed off each item's own raw
 * `<field>Id` value rather than a fetched related row (there is none to key
 * off, since the relation was never included).
 *
 * Field-level `read` access on the owning relationship field is NOT resolved
 * here — it is row-dependent and `filterReadableFields` already evaluates it
 * per row with no ORM access needed, so it is folded in there instead of
 * duplicated here. Every candidate still gets an entry (`{ kind: 'open' }`
 * when the related list's `query` access is fully allowed) rather than being
 * left out of the map, because `filterReadableFields` runs the field-level
 * check only for a key the map names — a column left out entirely would skip
 * that check too, not just this module's own operation-level one.
 */
export async function resolveForeignKeyVisibility(
  items: readonly Record<string, unknown>[],
  fieldConfigs: Record<string, FieldConfig>,
  requestedInclude: Record<string, unknown>,
  args: { session: Session | null; context: AccessContext },
  config: OpenSaasConfig,
  listKey: string,
): Promise<ForeignKeyVisibilityMap> {
  const map: Record<string, ForeignKeyVisibility> = {}

  for (const owner of unincludedForeignKeyOwners(fieldConfigs, requestedInclude, listKey, config)) {
    const related = getRelatedListConfig(owner.ref, config)
    if (!related) continue

    const access = await checkAccess(related.listConfig.access?.operation?.query, args)
    if (access === false) {
      map[owner.column] = { kind: 'denied' }
      continue
    }
    if (access === true) {
      map[owner.column] = { kind: 'open' }
      continue
    }

    const ids = new Set<string>()
    for (const item of items) {
      const value = item[owner.column]
      if (value !== null && value !== undefined) ids.add(String(value))
    }
    if (ids.size === 0) {
      map[owner.column] = { kind: 'scoped', ids: new Set() }
      continue
    }

    const model = ormModel(args.context.ormHandle, related.listName)
    const visibleRows = await model.findMany({
      where: { AND: [access, { id: { in: [...ids] } }] },
      select: { id: true },
    })
    const visibleIds = new Set<string>(
      Array.isArray(visibleRows) ? visibleRows.map((row) => String(row.id)) : [],
    )
    map[owner.column] = { kind: 'scoped', ids: visibleIds }
  }

  return map
}

/**
 * The field-level half of foreign-key visibility: whether `column`'s owning
 * relationship field's own `read` rule allows it, evaluated per row (it may
 * be row-dependent) with no ORM access. `filterReadableFields` calls this for
 * every key `foreignKeyVisibility` resolved, folding the answer together with
 * the map's own operation-level decision.
 */
export async function foreignKeyFieldAccess(
  column: string,
  fieldConfigs: Record<string, FieldConfig>,
  item: Record<string, unknown>,
  args: { session: Session | null; context: AccessContext & { _isSudo?: boolean } },
): Promise<boolean> {
  if (!column.endsWith('Id')) return true
  const fieldConfig = fieldConfigs[column.slice(0, -2)]
  if (fieldConfig === undefined) return true
  return checkFieldAccess(fieldConfig.access, 'read', { ...args, item })
}
