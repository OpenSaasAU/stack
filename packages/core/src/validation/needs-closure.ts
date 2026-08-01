import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import { getRelatedListConfig } from '../access/engine.js'
import { READ_INCLUDE_MAX_DEPTH } from '../access/depth-limits.js'

/**
 * A field's `needs` declaration (ADR-0025) whose closure — the recursive
 * fold of its own dependencies, and THEIR dependencies, and so on — cannot
 * be satisfied by the read pipeline, independent of where any caller starts
 * a read.
 *
 * Two distinct refusals, both fail-closed rather than silently truncated
 * (ADR-0022): `'cycle'` means the chain never terminates (e.g. `Order.total`
 * needs `lineItems`, `LineItem.orderRef` needs `order`); `'depth'` means it
 * terminates but reaches deeper than `READ_INCLUDE_MAX_DEPTH` even when
 * evaluated starting AT the declaring field's own list — the most
 * favourable starting point available, so no caller could ever do better.
 */
export interface NeedsClosureError {
  /** The list whose field declares the (transitively) unsatisfiable `needs`. */
  listKey: string
  /** The field key within that list. */
  fieldKey: string
  /** The list keys on the offending chain, starting at `listKey`. */
  chain: string[]
  reason: 'cycle' | 'depth' | 'invalid-relation'
  message: string
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

type ListClosureResult = { depth: number; chain: string[] } | { cycle: string[] }

/**
 * The deepest needs-chain reachable from `listKey`, considering EVERY field
 * on every list along the way that declares `needs` — not only the field
 * that triggered the walk. A computed field runs wherever its list's rows
 * are fetched, so once a list is reached, ALL of its own declared
 * dependencies must be satisfiable too (ADR-0025's "at every level a field
 * is computed").
 *
 * `path` is the list keys already on this DFS branch, root-first, used to
 * detect a cycle (a chain that can never terminate).
 */
function listClosureDepth(
  listKey: string,
  config: OpenSaasConfig,
  path: readonly string[],
): ListClosureResult {
  const listConfig = config.lists[listKey]
  if (!listConfig?.fields) return { depth: 0, chain: [listKey] }

  let maxDepth = 0
  let maxChain = [listKey]

  for (const fieldConfig of Object.values(listConfig.fields)) {
    if (!fieldConfig?.hooks?.resolveOutput) continue

    for (const relationName of fieldConfig.needs ?? []) {
      const relatedField = listConfig.fields[relationName]
      if (!isRelationshipFieldConfig(relatedField)) continue

      const relatedConfig = getRelatedListConfig(relatedField.ref, config)
      if (!relatedConfig) continue
      const relatedListKey = relatedConfig.listName

      if (path.includes(relatedListKey)) {
        return { cycle: [...path, relatedListKey] }
      }

      const sub = listClosureDepth(relatedListKey, config, [...path, relatedListKey])
      if ('cycle' in sub) return sub

      if (1 + sub.depth > maxDepth) {
        maxDepth = 1 + sub.depth
        maxChain = [listKey, ...sub.chain]
      }
    }
  }

  return { depth: maxDepth, chain: maxChain }
}

/**
 * Validate that every `needs` entry names an immediate relationship field
 * declared on the SAME list. The generated `Lists.<List>.TypeInfo` already
 * makes a misspelled or non-relation entry a compile error for a config
 * annotated with it (`list<Lists.X.TypeInfo>({...})`, the documented
 * pattern) — this is the runtime backstop for configs that aren't, or that
 * are authored in plain JS.
 *
 * @param config - The fully resolved OpenSaas config.
 * @returns All invalid `needs` entries, flattened across lists and fields.
 */
export function validateNeedsDeclarations(config: OpenSaasConfig): NeedsClosureError[] {
  const errors: NeedsClosureError[] = []

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    if (!listConfig?.fields) continue

    for (const [fieldKey, fieldConfig] of Object.entries(listConfig.fields)) {
      for (const relationName of fieldConfig?.needs ?? []) {
        if (isRelationshipFieldConfig(listConfig.fields[relationName])) continue

        const exists = relationName in listConfig.fields
        errors.push({
          listKey,
          fieldKey,
          chain: [listKey],
          reason: 'invalid-relation',
          message: exists
            ? `"${listKey}.${fieldKey}" declares needs: ['${relationName}'], but "${relationName}" ` +
              `is not a relationship field on "${listKey}". \`needs\` may only name immediate ` +
              `relationship fields declared on the same list.`
            : `"${listKey}.${fieldKey}" declares needs: ['${relationName}'], but "${listKey}" has ` +
              `no field named "${relationName}".`,
        })
      }
    }
  }

  return errors
}

/**
 * Validate that every field's `needs` closure fits within
 * `READ_INCLUDE_MAX_DEPTH` when evaluated starting at the declaring field's
 * own list — the most favourable starting point a caller could ever give it.
 * Intended to run once, before generation, exactly like
 * {@link validateConfigFields} — a config whose closure cannot fit must not
 * generate, per ADR-0025's "Depth" section.
 *
 * @param config - The fully resolved OpenSaas config.
 * @returns All unsatisfiable-closure violations, flattened across lists and fields.
 */
export function validateNeedsClosureDepth(config: OpenSaasConfig): NeedsClosureError[] {
  const errors: NeedsClosureError[] = []

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    if (!listConfig?.fields) continue

    for (const [fieldKey, fieldConfig] of Object.entries(listConfig.fields)) {
      if (!fieldConfig?.hooks?.resolveOutput || !fieldConfig.needs?.length) continue

      const result = listClosureDepth(listKey, config, [listKey])

      if ('cycle' in result) {
        errors.push({
          listKey,
          fieldKey,
          chain: result.cycle,
          reason: 'cycle',
          message:
            `"${listKey}.${fieldKey}"'s needs declaration never terminates: ` +
            `${result.cycle.join(' → ')} → … . A chain of \`needs\` across these lists cycles back ` +
            `on itself, so no read could ever satisfy it. Break the cycle by removing one of the ` +
            `\`needs\` entries on this chain, or compute the value without it.`,
        })
        continue
      }

      if (result.depth >= READ_INCLUDE_MAX_DEPTH) {
        errors.push({
          listKey,
          fieldKey,
          chain: result.chain,
          reason: 'depth',
          message:
            `"${listKey}.${fieldKey}"'s needs declaration requires a closure ${result.depth} ` +
            `relations deep even starting at "${listKey}" itself: ${result.chain.join(' → ')}. ` +
            `This exceeds the Access Filter's maximum read-include depth ` +
            `(${READ_INCLUDE_MAX_DEPTH}), so no caller — however they start the read — could ever ` +
            `have this closure satisfied. Shorten the \`needs\` chain across these lists.`,
        })
      }
    }
  }

  return errors
}
