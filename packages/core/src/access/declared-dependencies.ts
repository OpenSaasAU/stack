import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import { getRelatedListConfig } from './engine.js'
import type { FieldSelectionScope } from '../query/index.js'

/**
 * Declared Dependencies — folding a computed field's `needs` into a read's
 * `include` without widening what the caller receives (ADR-0025).
 *
 * A field's `needs` declares immediate sibling relations its `resolveOutput`
 * hook cannot compute without. This module folds those relations into
 * whatever `include` a read is already building (caller-supplied, fragment-
 * derived, or none at all) BEFORE it reaches the access-scoping pipeline
 * (`buildAccessScopedInclude` in `access-filter.ts`) — a declared relation is
 * scoped exactly like a caller-named one, never a bypass.
 *
 * The fold also tracks provenance: which relation keys, at which nesting
 * level, were added ONLY to satisfy a declaration (as opposed to being named
 * by the caller). `field-visibility.ts` uses that tree to strip those keys
 * from the result after `resolveOutput` hooks have had a chance to read them
 * — a declared dependency is private plumbing, not an implicit `include`.
 *
 * **Every relation this module reaches is folded recursively**, whether it
 * was added purely to satisfy a declaration or is already present for another
 * reason (caller/fragment-named, bare or not). Since ADR-0026 removed the
 * auto-expansion that used to carry a chain of declarations "for free" —
 * naming a relation now fetches its own columns and stops — a field computed
 * one hop down would otherwise lose its own declared dependencies the moment
 * its list is reached any way OTHER than an explicit nested caller `include`.
 * Declarations fold in "at every level a field is computed" (ADR-0025), not
 * only where the caller happened to write one out.
 *
 * A branch added purely by this fold (`declaredOnly.keys`) is stripped
 * wholesale by `filterReadableFields` regardless of what's nested inside it,
 * so its own nested declared-only keys need no individual tracking — only a
 * branch present for another reason (caller/fragment-named) needs the
 * fine-grained `declaredOnly.nested` tracking, so a declaration folded
 * beneath IT can be stripped without removing the caller's own data.
 *
 * **Cycle guard, re-pointed (ADR-0026).** A caller-supplied `include` is
 * always a finite literal and cannot cycle. Recursively following declared
 * dependencies across lists CAN — list A declaring `needs` on a relation to
 * list B, whose own field declares `needs` back to A — so `visitedLists`
 * carries the list names already on this fold's own path and stops rather
 * than recursing without bound. `pnpm generate`'s `validateNeedsClosureDepth`
 * (`needs-closure.ts`) is the primary backstop — a cyclic `needs` closure
 * fails generation and should never reach this code at runtime — this guard
 * is defense in depth, not the mechanism relied on for correctness.
 *
 * The guard applies to DECLARATION-ADDED edges only, which is exactly where
 * the unbounded recursion can come from: a branch added by this fold carries
 * no caller include of its own, so everything beneath it is declaration-added
 * too, and each such edge either reaches a list not yet on the path or stops
 * — bounding that suffix by the number of lists. An edge the request itself
 * named is bounded by the request's own finite literal instead. Applying the
 * guard to those as well would stop the fold at a path that merely revisits a
 * list (`Post → author → posts`, or a self-referential `parent`), silently
 * leaving the revisited list's own declared dependencies unsatisfied — the
 * `undefined`-compute ADR-0025 exists to prevent, at every level a field is
 * computed.
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

/**
 * The deduped set of relation names declared via `needs` by fields on this
 * list that have a `resolveOutput` hook. A `needs` entry on a field without
 * one is inert — there is no hook to feed it to — so it contributes nothing
 * to fetch.
 *
 * `selectedFields`, when given, restricts the union to fields the read is
 * actually going to return (ADR-0027) — a field a fragment did not select is
 * never computed, so its declared relation is never fetched for it either.
 * `undefined` means unrestricted: every field with a hook contributes,
 * matching a bare or `include`-based read, which always returns every
 * computed field on the list.
 */
export function getDeclaredRelationNames(
  fieldConfigs: Record<string, FieldConfig>,
  selectedFields?: ReadonlySet<string>,
): string[] {
  const names = new Set<string>()
  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    if (!fieldConfig?.hooks?.resolveOutput) continue
    if (selectedFields && !selectedFields.has(fieldName)) continue
    for (const name of fieldConfig.needs ?? []) {
      names.add(name)
    }
  }
  return [...names]
}

/**
 * Fold this list's declared dependencies into `rawInclude`, recursing into
 * EVERY relation reached from here — whether it was just added to satisfy a
 * declaration or was already present for another reason — so that list's own
 * declared dependencies are satisfied too, wherever it's reached (see module
 * doc comment).
 *
 * Returns `rawInclude` itself (same reference) when there is nothing to
 * fold, so a list with no `needs` fields and no caller include stays on the
 * exact bare-read path (ADR-0024) — untouched, not merely equivalent.
 *
 * `listKey` seeds the cycle guard at the root of a read; recursive calls
 * extend it with each related list reached along THIS fold's own path.
 *
 * `selection`, when given, is the fragment scope this level was reached
 * under (ADR-0027) — only fields it names contribute their `needs` (see
 * `getDeclaredRelationNames`). It is `undefined` for a bare/`include`-based
 * read (unrestricted: every field's `needs` folds in, unchanged from before
 * ADR-0027) and for any branch reached only to satisfy a declaration — a
 * relation added purely by this fold has no fragment scope of its own, so
 * its own list folds unrestricted, exactly as it did before selectivity
 * existed.
 */
export function foldDeclaredDependencies(
  rawInclude: Record<string, unknown> | undefined,
  fieldConfigs: Record<string, FieldConfig>,
  config: OpenSaasConfig,
  listKey: string,
  visitedLists: readonly string[] = [listKey],
  selection?: FieldSelectionScope,
): { include: Record<string, unknown> | undefined; declaredOnly: DeclaredOnlyTree } {
  const declaredNames = getDeclaredRelationNames(fieldConfigs, selection?.fields)

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

    const relatedConfig = getRelatedListConfig(fieldConfig.ref, config)
    if (!relatedConfig) continue
    // Defensive cycle guard (see module doc comment) — a DECLARATION-ADDED
    // edge into a list already on this path stops here rather than recursing
    // without bound. The value at `key` is left exactly as-is. The guard is
    // deliberately not applied to an edge the request itself named: that
    // recursion is bounded by the request's own finite literal and cannot
    // loop, so stopping it would silently drop the folds beneath a request
    // that merely revisits a list (e.g. `Post → author → posts`).
    if (declaredOnly.keys.has(key) && visitedLists.includes(relatedConfig.listName)) continue

    // A branch added purely by the fold has no fragment scope of its own —
    // it folds unrestricted, as before ADR-0027. A branch the request itself
    // named (caller include or fragment) carries that name's own nested
    // scope, if the fragment gave it one (a bare `true` selector leaves it
    // `undefined` — also unrestricted, since the caller asked for
    // "everything" there).
    const nestedSelection = declaredOnly.keys.has(key) ? undefined : selection?.nested[key]

    const explicitNested = getExplicitInclude(value)
    const nested = foldDeclaredDependencies(
      explicitNested,
      relatedConfig.listConfig.fields,
      config,
      relatedConfig.listName,
      [...visitedLists, relatedConfig.listName],
      nestedSelection,
    )

    if (nested.include) {
      merged[key] = {
        ...(typeof value === 'object' && value ? value : {}),
        include: nested.include,
      }
    }

    // A whole branch added purely by the fold above is stripped wholesale by
    // field-visibility regardless of what's nested inside it, so it needs no
    // individual nested-key tracking of its own.
    if (!declaredOnly.keys.has(key) && !isDeclaredOnlyTreeEmpty(nested.declaredOnly)) {
      declaredOnly.nested[key] = nested.declaredOnly
    }
  }

  return { include: merged, declaredOnly }
}
