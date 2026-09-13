// Always present, never declared in a list's `fields` — the write path
// (`filterWritableFields`) excludes the same three names from `fieldConfigs`.
const SYSTEM_FIELDS = new Set(['id', 'createdAt', 'updatedAt'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- field configs are heterogeneous across field types
type FieldConfigMap = Record<string, any>

export interface ResolvedQueryField {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- field configs are heterogeneous across field types
  fieldConfig: any
  isRelationship: boolean
}

/**
 * Resolve a `where`/`orderBy`/`select` key against a list's declared fields —
 * the shared shape-recognition the secured surface's own vocabulary
 * resolution (`secured/vocabulary.ts`), include refinement (`secured/
 * include.ts`) and projection (`secured/select.ts`) all key off, so a key's
 * validity is decided in exactly one place.
 *
 * A key is valid when it is:
 * - a system field (`id`, `createdAt`, `updatedAt`) — always present, and never
 *   declared in `fields` (the write path excludes them from `fieldConfigs` the
 *   same way), or
 * - a field declared directly in the list config, or
 * - the foreign-key scalar a to-one `relationship` field implies (e.g. `authorId`
 *   for `author: relationship(...)`) — the config never names this column
 *   directly, but Prisma always generates it, and the write path
 *   (`filterWritableFields`) grants it the same pass, or
 * - a raw per-part column a multi-column field's `splitColumns` contributes (e.g.
 *   storage `image()`/`file()` in Keystone-parity mode) — undeclared by design,
 *   mirroring the write path's `splitColumnOwners` allowance (#568/#789).
 *
 * Anything else — most importantly a Prisma-generated back-relation the config
 * never declares — resolves to `undefined` and is rejected by the caller.
 */
export function resolveQueryField(
  key: string,
  fields: FieldConfigMap,
): ResolvedQueryField | undefined {
  if (SYSTEM_FIELDS.has(key)) {
    return { fieldConfig: undefined, isRelationship: false }
  }

  const fieldConfig = fields[key]
  if (fieldConfig) {
    return { fieldConfig, isRelationship: fieldConfig.type === 'relationship' }
  }

  if (key.endsWith('Id')) {
    const baseField = fields[key.slice(0, -2)]
    if (baseField && baseField.type === 'relationship' && !baseField.many) {
      return { fieldConfig: baseField, isRelationship: false }
    }
  }

  for (const [ownerName, owner] of Object.entries(fields)) {
    if (owner && typeof owner.getColumnNames === 'function') {
      const columns: string[] = owner.getColumnNames(ownerName)
      if (columns.includes(key)) {
        return { fieldConfig: owner, isRelationship: false }
      }
    }
  }

  return undefined
}
