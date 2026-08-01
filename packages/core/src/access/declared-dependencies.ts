import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import { getRelatedListConfig } from './engine.js'

/**
 * Declared Dependencies — folding a computed field's `needs` into a read's
 * `include` without widening what the caller receives (ADR-0025).
 *
 * A field's `needs` declares immediate sibling relations its `resolveOutput`
 * hook cannot compute without. This module folds those relations into
 * whatever `include` a read is already building (caller-supplied, fragment-
 * derived, or none at all) BEFORE it reaches the existing access-scoping
 * pipeline (`buildIncludeWithAccessControl` / `mergeIncludeWithAccessControl`
 * in `access-filter.ts`) — a declared relation is scoped exactly like a
 * caller-named one, never a bypass.
 *
 * The fold also tracks provenance: which relation keys, at which nesting
 * level, were added ONLY to satisfy a declaration (as opposed to being named
 * by the caller). `field-visibility.ts` uses that tree to strip those keys
 * from the result after `resolveOutput` hooks have had a chance to read them
 * — a declared dependency is private plumbing, not an implicit `include`.
 *
 * Reach beyond one hop: a relation added here to satisfy a declaration is
 * added BARE (`true`), never with an explicit nested include of its own.
 * `buildIncludeWithAccessControl` already auto-expands a bare relation's own
 * readable-relationship subtree to `READ_INCLUDE_MAX_DEPTH` (pre-ADR-0026),
 * so a chain of declarations rides that existing expansion for free — the
 * related list's own declared needs are already present among what gets
 * auto-included beneath it. This is also why a declaration-driven cycle
 * (e.g. `Order.total` needs `lineItems`, `LineItem.orderRef` needs `order`)
 * can't recurse without bound here: it flows through
 * `buildIncludeWithAccessControl`'s existing `visitedLists` cycle guard
 * rather than through any recursion of this module's own (see ADR-0026's
 * note that this guard's remaining job, after that ADR lands, is defending
 * exactly this fold).
 *
 * This module only recurses into EXPLICIT nested includes the caller wrote
 * (narrowing what's fetched below a relation) — those cut off the free
 * auto-expansion, so a nested list's own declared needs must be folded in
 * explicitly. An explicit caller include is always a finite literal, so this
 * recursion terminates on its own without a separate depth/cycle guard.
 */

/** Which relation keys, at which nesting level, exist only to satisfy a `needs` declaration. */
export type DeclaredOnlyTree = {
  /** Keys at THIS level whose entire branch was added purely by the fold. */
  keys: Set<string>
  /** Per-key trees for relations present in the include for other reasons (caller-named), whose OWN nested include may still contain declaration-only keys. */
  nested: Record<string, DeclaredOnlyTree>
}

export function emptyDeclaredOnlyTree(): DeclaredOnlyTree {
  return { keys: new Set(), nested: {} }
}

function isDeclaredOnlyTreeEmpty(tree: DeclaredOnlyTree): boolean {
  return tree.keys.size === 0 && Object.keys(tree.nested).length === 0
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
 * The deduped set of relation names declared via `needs` by fields on this
 * list that have a `resolveOutput` hook. A `needs` entry on a field without
 * one is inert — there is no hook to feed it to — so it contributes nothing
 * to fetch.
 */
export function getDeclaredRelationNames(fieldConfigs: Record<string, FieldConfig>): string[] {
  const names = new Set<string>()
  for (const fieldConfig of Object.values(fieldConfigs)) {
    if (!fieldConfig?.hooks?.resolveOutput) continue
    for (const name of fieldConfig.needs ?? []) {
      names.add(name)
    }
  }
  return [...names]
}

/**
 * Fold this list's declared dependencies into `rawInclude`, recursing into
 * any EXPLICIT nested include the caller wrote so a related list's own
 * declared needs are satisfied too (see module doc comment).
 *
 * Returns `rawInclude` itself (same reference) when there is nothing to
 * fold, so a list with no `needs` fields and no caller include stays on the
 * exact bare-read path (ADR-0024) — untouched, not merely equivalent.
 */
export function foldDeclaredDependencies(
  rawInclude: Record<string, unknown> | undefined,
  fieldConfigs: Record<string, FieldConfig>,
  config: OpenSaasConfig,
): { include: Record<string, unknown> | undefined; declaredOnly: DeclaredOnlyTree } {
  const declaredNames = getDeclaredRelationNames(fieldConfigs)

  if (declaredNames.length === 0 && !rawInclude) {
    return { include: rawInclude, declaredOnly: emptyDeclaredOnlyTree() }
  }

  const declaredOnly = emptyDeclaredOnlyTree()
  const merged: Record<string, unknown> = { ...(rawInclude ?? {}) }

  for (const name of declaredNames) {
    if (name in merged) continue // caller (or fragment) already asked for it — not declaration-only
    if (!isRelationshipFieldConfig(fieldConfigs[name])) continue // invalid `needs` entry; caught by generate-time validation
    merged[name] = true
    declaredOnly.keys.add(name)
  }

  for (const [key, value] of Object.entries(merged)) {
    const fieldConfig = fieldConfigs[key]
    if (!isRelationshipFieldConfig(fieldConfig)) continue
    // A whole branch we just added is bare `true` — its own subtree auto-expands
    // (see module doc comment), so there is no explicit nested include to recurse into.
    if (declaredOnly.keys.has(key)) continue

    const entry = value as { include?: Record<string, unknown> } | boolean
    if (!entry || typeof entry !== 'object' || !entry.include) continue

    const relatedConfig = getRelatedListConfig(fieldConfig.ref, config)
    if (!relatedConfig) continue

    const nested = foldDeclaredDependencies(entry.include, relatedConfig.listConfig.fields, config)
    if (nested.include !== entry.include) {
      merged[key] = { ...entry, include: nested.include }
    }
    if (!isDeclaredOnlyTreeEmpty(nested.declaredOnly)) {
      declaredOnly.nested[key] = nested.declaredOnly
    }
  }

  return { include: merged, declaredOnly }
}
