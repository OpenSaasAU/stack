export type ConfigRefusalReason =
  | 'index-sort'
  | 'id-field-on-singleton'
  | 'duplicate-extension-pack'
  | 'many-to-many'
  | 'foreign-key-on-both-sides'
  | 'non-owning-side-nullability'
  | 'non-owning-side-index'
  | 'non-owning-side-referential-action'
  | 'set-null-on-required-relation'
  | 'self-referencing-field'
  | 'composite-keyed-target'

/**
 * A config declaration the Prisma 8 contract cannot carry, found before
 * generation. Every refusal names the list (when there is one), the entry as
 * the author spelled it, and the fix.
 */
export interface ConfigRefusal {
  /** The list the entry belongs to; absent for a config-level entry such as `db.extensions[1]`. */
  listKey?: string
  /** The refused entry — `fields.author`, `db.indexes[0]`, `db.idField`, `db.extensions[1]`. */
  entry: string
  reason: ConfigRefusalReason
  /** Ready to print: names the list, the entry and the fix. */
  message: string
}
