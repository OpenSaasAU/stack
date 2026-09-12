import type { FieldConfig, OpenSaasConfig } from '../config/types.js'

/**
 * A `needs` declaration (ADR-0025) nothing can satisfy, refused at generation
 * rather than silently ignored at runtime.
 *
 * The dependency set is one hop and non-transitive (ADR-0051), so there is no
 * closure left to be cyclic or too deep — `validateNeedsClosureDepth` and its
 * `'cycle'`/`'depth'` refusals are deleted along with the runtime fold that
 * needed them.
 */
export interface NeedsClosureError {
  /** The list whose field declares the unsatisfiable `needs`. */
  listKey: string
  /** The field key within that list. */
  fieldKey: string
  /** The list keys on the offending chain, starting at `listKey`. */
  chain: string[]
  /**
   * `'invalid-dependency'` — an entry names nothing on the list, or names a
   * computed field; `'no-resolve-output'` — the declaring field has no
   * `resolveOutput` hook to consume it (ADR-0051).
   */
  reason: 'invalid-dependency' | 'no-resolve-output'
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

/**
 * Validate that every `needs` entry names a stored column or an immediate
 * relationship field declared on the SAME list (ADR-0051), and that the
 * declaring field has a `resolveOutput` hook to consume it. The generated
 * `Lists.<List>.TypeInfo` already makes a misspelled or computed entry a
 * compile error for a config annotated with it (`list<Lists.X.TypeInfo>({...})`,
 * the documented pattern) — this is the runtime backstop for configs that
 * aren't, or that are authored in plain JS.
 *
 * @param config - The fully resolved OpenSaas config.
 * @returns All invalid `needs` entries, flattened across lists and fields.
 */
export function validateNeedsDeclarations(config: OpenSaasConfig): NeedsClosureError[] {
  const errors: NeedsClosureError[] = []

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    if (!listConfig?.fields) continue

    for (const [fieldKey, fieldConfig] of Object.entries(listConfig.fields)) {
      const needs = fieldConfig?.needs ?? []
      if (needs.length === 0) continue

      if (!fieldConfig?.hooks?.resolveOutput) {
        errors.push({
          listKey,
          fieldKey,
          chain: [listKey],
          reason: 'no-resolve-output',
          message:
            `"${listKey}.${fieldKey}" declares needs: [${needs.map((n) => `'${n}'`).join(', ')}] ` +
            `but has no resolveOutput hook, so nothing can consume the declaration. Add the ` +
            `hook that reads these dependencies, or remove \`needs\` from "${listKey}.${fieldKey}".`,
        })
        continue
      }

      for (const dependencyName of needs) {
        const dependency = listConfig.fields[dependencyName]
        if (isRelationshipFieldConfig(dependency)) continue
        if (dependency && dependency.virtual !== true && dependency.type !== 'virtual') continue

        errors.push({
          listKey,
          fieldKey,
          chain: [listKey],
          reason: 'invalid-dependency',
          message: dependency
            ? `"${listKey}.${fieldKey}" declares needs: ['${dependencyName}'], but "${dependencyName}" ` +
              `is a computed field on "${listKey}". \`needs\` may only name stored columns and ` +
              `immediate relationship fields declared on the same list.`
            : `"${listKey}.${fieldKey}" declares needs: ['${dependencyName}'], but "${listKey}" has ` +
              `no field named "${dependencyName}".`,
        })
      }
    }
  }

  return errors
}
