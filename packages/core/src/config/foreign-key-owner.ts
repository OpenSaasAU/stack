import type { OpenSaasConfig, RelationshipField } from './types.js'
import { shouldHaveForeignKey } from '../fields/index.js'

/**
 * Whether this end of the relationship holds the foreign-key column.
 *
 * `shouldHaveForeignKey` throws on a config `generate` would have refused — a
 * ref naming a list or field that is not declared, or a one-to-one claiming
 * `db.foreignKey` on both ends. A listing asks this of every field at once, so
 * letting that escape would fail the whole listing over one bad field; an
 * ownership question with no answer is treated as "not this end", which at
 * worst omits a field the engine would have refused anyway.
 */
export function ownsForeignKey(
  listKey: string,
  fieldName: string,
  fieldConfig: RelationshipField,
  config: OpenSaasConfig,
): boolean {
  if (!config.lists[fieldConfig.ref.split('.')[0]]) return false
  try {
    return shouldHaveForeignKey(listKey, fieldName, fieldConfig, config)
  } catch {
    return false
  }
}
