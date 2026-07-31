import type { Session, AccessContext, PrismaFilter } from './types.js'
import type { OpenSaasConfig, FieldConfig } from '../config/types.js'
import { checkAccess, getRelatedListConfig } from './engine.js'
import { READ_INCLUDE_MAX_DEPTH } from './depth-limits.js'
import { AccessScopeDepthExceededError } from './errors.js'

/**
 * Access Filter — phase 1 of the two-phase read (pre-query).
 *
 * This module scopes which rows and relationships the database is allowed to
 * return, before the query runs. It evaluates *operation-level* `query` access
 * on related lists and turns the results into a Prisma `include`/`where` clause,
 * so denied rows and relations never leave the database.
 *
 * Phase 2 (post-query field stripping + `resolveOutput` + virtual computation)
 * lives in `field-visibility.ts`. The two phases cannot be merged: virtual
 * fields are computed in JavaScript and post-query field access can depend on
 * the fetched row, neither of which is expressible in SQL. See
 * `docs/adr/0001-access-control-is-a-two-phase-read.md` and the access-control
 * glossary in `CONTEXT.md`.
 */

/** A single relation entry in a Prisma `include` object (see below). */
type IncludeEntry = boolean | { where?: PrismaFilter; include?: IncludeObject; take?: number }
type IncludeObject = Record<string, IncludeEntry>

/**
 * The result of trying to compute an access-controlled include for a list's
 * fields. `buildIncludeWithAccessControl` used to collapse three unrelated
 * outcomes into a single overloaded `undefined`: "inside a resolveOutput
 * context", "hit the depth cap", and "no relationships to scope" all looked
 * identical to callers, which is what let a depth-capped relation pass
 * through unscoped (issue #830). This discriminated result keeps them
 * distinguishable all the way to `mergeIncludeWithAccessControl`, which is the
 * only place that knows whether a caller actually asked for the part that
 * couldn't be scoped.
 *
 * - `scoped`: relationships were found and (to the extent depth allows)
 *   access-controlled; `include` is the resulting tree.
 * - `nothing-to-scope`: the list genuinely has no relationships to scope, OR
 *   we are inside a resolveOutput/virtual-field context and deliberately did
 *   not descend into a relation's own nested relations. Passing the caller's
 *   include through unchanged here is correct, not a leak.
 * - `depth-exceeded`: we could not evaluate this level at all because it sits
 *   at or past `READ_INCLUDE_MAX_DEPTH`. This is a denial: a caller `include`
 *   that reaches here must be rejected, not passed through.
 */
export type AccessIncludeResult =
  | { kind: 'scoped'; include: RichIncludeObject }
  | { kind: 'nothing-to-scope' }
  | { kind: 'depth-exceeded' }

/** A relation entry in the rich, provenance-carrying tree `buildIncludeWithAccessControl` builds internally. */
type RichIncludeEntry = { where?: PrismaFilter; nested: AccessIncludeResult }
type RichIncludeObject = Record<string, RichIncludeEntry>

/**
 * Collapse a rich, provenance-carrying include entry down to the plain
 * Prisma-shaped form. A `nested` result that is `depth-exceeded` or
 * `nothing-to-scope` contributes no `include` key — this is the AUTO-include
 * silently stopping, which is correct when no caller asked for anything past
 * this point (see `AccessIncludeResult` doc comment).
 */
function toPrismaEntry(entry: RichIncludeEntry): IncludeEntry {
  const result: { where?: PrismaFilter; include?: IncludeObject } = {}
  if (entry.where) result.where = entry.where
  if (entry.nested.kind === 'scoped') {
    const nestedInclude = toPrismaInclude(entry.nested)
    if (nestedInclude && Object.keys(nestedInclude).length > 0) {
      result.include = nestedInclude
    }
  }
  return Object.keys(result).length > 0 ? result : true
}

/**
 * Collapse an `AccessIncludeResult` to the plain Prisma `include` shape used
 * when there is no caller-supplied include to merge against (the direct
 * auto-include path). `nothing-to-scope` and `depth-exceeded` both become
 * `undefined` here — at this call site nothing was explicitly requested past
 * either boundary, so there is nothing to deny.
 */
export function toPrismaInclude(result: AccessIncludeResult): IncludeObject | undefined {
  if (result.kind !== 'scoped') return undefined
  const out: IncludeObject = {}
  for (const [key, entry] of Object.entries(result.include)) {
    out[key] = toPrismaEntry(entry)
  }
  return out
}

/**
 * Build the access-controlled include for a list's fields.
 *
 * This allows us to filter relationships at the database level instead of in
 * memory. Returns an {@link AccessIncludeResult} rather than a plain include
 * object so that `mergeIncludeWithAccessControl` can tell a genuine "nothing
 * to scope" apart from "the engine hit its depth cap" (see that type's doc
 * comment and ADR-0022).
 */
export async function buildIncludeWithAccessControl(
  fieldConfigs: Record<string, FieldConfig>,
  args: {
    session: Session | null
    context: AccessContext
  },
  config: OpenSaasConfig,
  depth: number = 0,
  // List names already on the path from the root to here. Used to detect
  // relationship cycles (A → B → … → A) and stop the auto-include from
  // re-descending them. Seed it with the root list name at the call site.
  visitedLists: readonly string[] = [],
): Promise<AccessIncludeResult> {
  if (depth >= READ_INCLUDE_MAX_DEPTH) {
    return { kind: 'depth-exceeded' }
  }

  // Inside a resolveOutput/virtual-field context we still scope each immediate
  // relation (its own access `where`), but do not auto-expand INTO its nested
  // relations — this keeps a single hook-issued read's include from growing
  // depth-first. Correction (ADR-0023): this does NOT by itself terminate a
  // cycle, despite what an earlier version of this comment claimed. A
  // self-referential relation read from inside a hook is a NEW top-level
  // read, invisible to this function's own recursion — the loop runs through
  // the hook↔read boundary, not through repeated calls to
  // `buildIncludeWithAccessControl`. Loop termination is the resolve chain's
  // job: `field-visibility.ts`'s `resolveReadableFieldValue` refuses to
  // re-enter a `(list, field)` pair already on the chain. What this check
  // still does correctly is row-scope the immediate relation rather than
  // skipping scoping altogether (issue #830's second trigger).
  const insideResolveOutput = args.context._resolveOutputChain.length > 0

  const include: RichIncludeObject = {}
  let hasRelationships = false

  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    if (fieldConfig?.type === 'relationship' && 'ref' in fieldConfig && fieldConfig.ref) {
      hasRelationships = true
      const relatedConfig = getRelatedListConfig(fieldConfig.ref as string, config)

      if (relatedConfig) {
        // Check query access for the related list
        const queryAccess = relatedConfig.listConfig.access?.operation?.query
        const accessResult = await checkAccess(queryAccess, {
          session: args.session,
          context: args.context,
        })

        // If access is completely denied, exclude this relationship
        if (accessResult === false) {
          continue
        }

        const where = typeof accessResult === 'object' ? accessResult : undefined

        // Cycle guard: if the related list already appears on the path from the
        // root, DO NOT auto-include its relationships again. On a cyclic
        // readable-relationship graph (A → B → … → A) the depth-first walk would
        // otherwise re-descend the cycle on every branch, and — combined with the
        // bare-`true` leaf re-expansion in `mergeIncludeWithAccessControl` — build
        // an include tree deep/large enough to overflow the call stack in
        // downstream processing (the RSC serializer's recursive `Map.set`). This
        // extends the SF-20 (#566) fix: a bare-`true` leaf must resolve to a
        // genuine single-level fetch, not a re-expansion of the full auto-include.
        // The relation itself is still included (as a FLAT fetch of its own
        // columns); only its onward relationships are pruned at the back-edge.
        let nested: AccessIncludeResult = { kind: 'nothing-to-scope' }
        const relatedListName = relatedConfig.listName
        if (!insideResolveOutput && !visitedLists.includes(relatedListName)) {
          nested = await buildIncludeWithAccessControl(
            relatedConfig.listConfig.fields,
            args,
            config,
            depth + 1,
            [...visitedLists, relatedListName],
          )
        }

        include[fieldName] = { where, nested }
      }
    }
  }

  return hasRelationships ? { kind: 'scoped', include } : { kind: 'nothing-to-scope' }
}

/** The structured (object) form of a relation include entry. */
type IncludeEntryObject = { where?: PrismaFilter; include?: IncludeObject; take?: number }

/**
 * Narrow an unknown include value to the structured object form (vs bare `true`
 * or any other primitive). Caller-supplied includes arrive untyped at the
 * runtime boundary, so we validate the shape here rather than casting.
 *
 * A numeric `take` on a to-many relation include (a caller-supplied row bound,
 * issue #752) is carried through: it only ever NARROWS the fetched rows and can
 * never widen past the access `where`, so preserving it is access-neutral. The
 * access-controlled include never sets `take` itself — it originates solely
 * from the caller — so `mergeIncludeWithAccessControl` re-attaches it below.
 */
function asEntryObject(value: unknown): IncludeEntryObject | null {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const where = obj.where
    const include = obj.include
    const take = obj.take
    const entry: IncludeEntryObject = {}
    if (where && typeof where === 'object') entry.where = where as PrismaFilter
    if (include && typeof include === 'object') entry.include = include as IncludeObject
    if (typeof take === 'number') entry.take = take
    return entry
  }
  return null
}

/**
 * AND-combine an access `where` with a caller-supplied nested `where`.
 *
 * The access filter is authoritative: the caller's filter may only NARROW the
 * result further, never widen past what access permits. We therefore wrap both
 * in a Prisma `AND` so neither can override the other. If only one side is
 * present, it is returned as-is; if neither is present, the result is undefined.
 */
function andWhere(
  accessWhere: PrismaFilter | undefined,
  callerWhere: PrismaFilter | undefined,
): PrismaFilter | undefined {
  if (accessWhere && callerWhere) {
    return { AND: [accessWhere, callerWhere] }
  }
  return accessWhere ?? callerWhere
}

/**
 * Merge a caller-supplied `include` with the access-controlled include — phase-1
 * row/relation scoping for explicit caller selections.
 *
 * The caller's `include` decides WHICH relations to fetch; access control decides
 * WHETHER each relation may be fetched and WITH WHAT filter. Replacing the
 * access-controlled include with the caller's wholesale (the bug in #566) drops
 * every per-relation access `where` and denied-relation exclusion, silently
 * bypassing row-level access on any non-sudo read that passes `include`.
 *
 * For each relation the caller asks to include:
 * - If the relation is a config-declared relationship but is ABSENT from the
 *   access-controlled include, its `query` access returned `false` → it is DROPPED
 *   (not fetched).
 * - If it is present (allowed, possibly with a filter), the access entry is used
 *   as the base: the access `where` is AND-combined with any caller-supplied
 *   nested `where`, and nested includes are recursively merged using the related
 *   list's field configs (so deeply-nested selections are filtered at every
 *   level). A bare caller `true` becomes the access-controlled shape (filter +
 *   nested filtered include), never bare `true`.
 * - If the caller names a key that is NOT a config-declared relationship, it is
 *   passed through unchanged (access control does not govern it).
 *
 * `accessControlledInclude` is the {@link AccessIncludeResult} for THIS level:
 * - `nothing-to-scope` → nothing to merge against (the list has no
 *   relationships, or we're inside a resolveOutput context where the caller
 *   include is irrelevant to begin with). Pass the caller's include through
 *   unchanged — this is a non-denial outcome, not "every relation denied".
 * - `depth-exceeded` → the engine could not compute a scope for THIS level at
 *   all because it sits at or past `READ_INCLUDE_MAX_DEPTH`. If the caller
 *   named anything here, that is exactly the case that used to pass through
 *   unscoped (issue #830): throw `AccessScopeDepthExceededError` instead. An
 *   empty caller include at this level (nothing further requested) is not an
 *   error — there's simply nothing to do.
 * - `scoped` → the normal per-relation merge below: a declared relationship
 *   ABSENT from the access include was denied (drop it); one PRESENT is used
 *   as the base, AND-combining `where`s and recursing into nested includes.
 *
 * `listKey` and `depth` are carried only to build a useful
 * `AccessScopeDepthExceededError` message; they do not affect merge behaviour.
 */
export function mergeIncludeWithAccessControl(
  callerInclude: Record<string, unknown>,
  accessControlledInclude: AccessIncludeResult,
  fieldConfigs: Record<string, FieldConfig>,
  config: OpenSaasConfig,
  listKey: string,
  depth: number = 0,
): Record<string, unknown> {
  if (accessControlledInclude.kind === 'nothing-to-scope') {
    return callerInclude
  }

  if (accessControlledInclude.kind === 'depth-exceeded') {
    const [firstRelationName] = Object.keys(callerInclude)
    if (firstRelationName !== undefined) {
      throw new AccessScopeDepthExceededError(listKey, firstRelationName, depth)
    }
    return {}
  }

  const merged: Record<string, unknown> = {}
  const accessInclude = accessControlledInclude.include

  for (const [relationName, callerValue] of Object.entries(callerInclude)) {
    const fieldConfig = fieldConfigs[relationName]
    const isDeclaredRelationship =
      fieldConfig?.type === 'relationship' && 'ref' in fieldConfig && !!fieldConfig.ref

    // Not a config-declared relationship → access control does not govern it; pass through unchanged.
    if (!isDeclaredRelationship) {
      merged[relationName] = callerValue
      continue
    }

    const accessEntry = accessInclude[relationName]

    // Declared relationship absent from the access include → query access denied → drop it.
    if (accessEntry === undefined) {
      continue
    }

    const callerEntry = asEntryObject(callerValue)

    // Resolve the related list's field configs so nested includes merge recursively.
    const relatedConfig = getRelatedListConfig(fieldConfig.ref as string, config)
    const relatedFields = relatedConfig?.listConfig.fields

    const mergedWhere = andWhere(accessEntry.where, callerEntry?.where)

    let mergedNested: Record<string, unknown> | undefined
    if (callerEntry?.include && relatedFields && relatedConfig) {
      // Recurse: scope the caller's nested selection against the nested access
      // result. If that result is 'depth-exceeded', the recursive call itself
      // throws — the caller named something the engine cannot scope.
      mergedNested = mergeIncludeWithAccessControl(
        callerEntry.include,
        accessEntry.nested,
        relatedFields,
        config,
        relatedConfig.listName,
        depth + 1,
      )
    } else if (accessEntry.nested.kind === 'scoped') {
      // Caller selected the relation bare (no nested include); keep the
      // access-controlled nested include so deeper relations stay filtered.
      mergedNested = toPrismaInclude(accessEntry.nested)
    }
    // If the caller's entry has no nested include, a 'depth-exceeded' nested
    // result is silent here too — nothing was asked for past this point.

    const entry: { where?: PrismaFilter; include?: Record<string, unknown>; take?: number } = {}
    if (mergedWhere) entry.where = mergedWhere
    if (mergedNested && Object.keys(mergedNested).length > 0) entry.include = mergedNested
    // Preserve a caller-supplied row bound on the relation (issue #752). It only
    // narrows, never widens, so it rides on top of the access `where`/include.
    if (callerEntry?.take !== undefined) entry.take = callerEntry.take

    // A bare-`true` relation with no access filter, nested include, or row bound stays `true`.
    merged[relationName] = Object.keys(entry).length > 0 ? entry : true
  }

  return merged
}

/**
 * Remove keys that correspond to `virtual` fields from a Prisma `include`
 * object, recursing into nested relationship includes using the related
 * list's field configs.
 *
 * Virtual fields are computed in JavaScript (via `resolveOutput` in
 * `field-visibility.ts`) and have no database column. Naming one in `include`
 * type-checks — the generated `Include` type lists every field the config
 * declares — but Prisma throws `Unknown field '<name>' for include statement`
 * at runtime. This is applied as the final step on whatever `include` a read
 * op ends up with (fragment-built, access-controlled merge, or sudo
 * passthrough) so a virtual key never reaches the Prisma client, regardless
 * of which path produced it. The virtual value is still computed
 * unconditionally by `filterReadableFields`, so stripping the include key has
 * no effect on whether the value appears in the result (#628).
 */
export function stripVirtualFieldsFromInclude(
  include: Record<string, unknown> | undefined,
  fieldConfigs: Record<string, FieldConfig>,
  config: OpenSaasConfig,
): Record<string, unknown> | undefined {
  if (!include) return include

  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(include)) {
    const fieldConfig = fieldConfigs[key]

    // Virtual fields have no database column — drop them from the include.
    if (fieldConfig?.virtual) continue

    const isDeclaredRelationship =
      fieldConfig?.type === 'relationship' && 'ref' in fieldConfig && !!fieldConfig.ref
    const entry = asEntryObject(value)

    if (isDeclaredRelationship && entry?.include) {
      const relatedConfig = getRelatedListConfig(fieldConfig.ref as string, config)
      if (relatedConfig) {
        const nestedInclude = stripVirtualFieldsFromInclude(
          entry.include,
          relatedConfig.listConfig.fields,
          config,
        )
        result[key] = { ...(value as Record<string, unknown>), include: nestedInclude }
        continue
      }
    }

    result[key] = value
  }

  return result
}
