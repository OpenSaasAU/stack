import type { Session, AccessContext, PrismaFilter } from './types.js'
import type { OpenSaasConfig, FieldConfig, ListConfig } from '../config/types.js'
import { checkAccess, getRelatedListConfig, resolveSyntheticReverseRelation } from './engine.js'
import { READ_INCLUDE_MAX_DEPTH } from './depth-limits.js'
import {
  AccessScopeDepthExceededError,
  RelationFilterAccessDeniedError,
  UndeclaredIncludeKeyError,
} from './errors.js'
import {
  LOGICAL_OPERATORS,
  RELATION_QUANTIFIERS,
  resolveQueryField,
  validateQueryFieldReadAccess,
  validateQueryKeys,
  walkWhereReadAccess,
  type ResolveSyntheticRelation,
  type SyntheticRelationTarget,
} from './query-validation.js'
import { getDbKey } from '../lib/case-utils.js'

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
 *
 * **Caller-directed (ADR-0026).** `buildAccessScopedInclude` walks only the
 * branches `requestedInclude` names — the caller's own `include`, a fragment
 * `query`'s projection, or `foldDeclaredDependencies`'s fold of a field's
 * `needs` (`declared-dependencies.ts`), all resolved before this module ever
 * runs. Naming a relation fetches that relation's own columns and stops
 * (the "One hop" rule, see `CONTEXT.md`); reaching further means the request
 * named a nested `include` there too. A relation nobody named never has its
 * list's `query` access evaluated at all — there is no separate "build the
 * whole tree, then reconcile against what was asked for" pass to walk it.
 *
 * **To-one relations are scoped after the query, not inside it (issue #974).**
 * Prisma accepts a nested `where` on an `include` entry only for a to-**many**
 * relation; the same shape on a to-**one** relation raises
 * `PrismaClientValidationError`. So for a to-one relation whose related
 * list's `query` access resolves to a filter, `buildAccessScopedInclude`
 * does NOT attach that filter as `where` — it fetches the row unscoped and
 * records the filter in the returned `toOneAccessFilters` tree instead.
 * `resolveToOneAccessVisibility` (below) turns that tree into the set of
 * related ids the session may actually see, via ONE batched `id IN (...)`
 * existence check per (relation, nesting level) across every row in the
 * read — never a per-row query, and never a hand-rolled evaluation of the
 * access filter (it is handed to Prisma exactly as `checkAccess` produced
 * it). `field-visibility.ts`'s `filterReadableFields` is where the result
 * actually becomes `null` for a row the check excludes — see its module doc.
 * A to-one relation whose related list's `query` access is `true` (no
 * filter) or `false` (denied outright) needs no existence check at all: the
 * former is left as `true` in `include`, unchanged from before; the latter
 * is recorded as `{ kind: 'denied' }`, and `field-visibility.ts` forces the
 * key to `null` without ever asking Prisma for it.
 *
 * **A denied to-many relation is recorded the same way (issue #1103).** An
 * outright `query` denial (`=== false`) drops the relation from `include`
 * regardless of arity — a to-many relation has no more of a `where` shape
 * for "denied" than a to-one one does. Before this, only the to-one branch
 * recorded anything; a denied to-many key was simply absent from the raw
 * row, and `filterReadableFields`'s main loop — which only ever visits keys
 * `Object.entries(workingItem)` actually contains — had nothing to force it
 * with, so it stayed missing from the result instead of coming back `[]`.
 * Now both arities record `{ kind: 'denied' }` in `toOneAccessFilters`, and
 * `field-visibility.ts`'s post-query pass forces the key present using the
 * field's own declared arity: `null` for a to-one relation, `[]` for a
 * to-many one.
 *
 * **A synthetic back-relation is a declared relationship wherever a caller
 * can name one (issue #1082).** A list-only `ref` (`ref: 'Other'`,
 * no target field) makes schema generation synthesize a back-relation on
 * `Other` (`from_<List>_<field>`) because the ORM requires an opposite field
 * there — but no list config declares it, so it is absent from `Other`'s own
 * `fieldConfigs`. An include key that fails the declared-relationship test is
 * resolved via `resolveSyntheticReverseRelation` before being treated as
 * unrecognised; a hit is scoped exactly like the declared relationship field
 * it stands for (its owning list's `query` access, folded `where`, nested
 * recursion, depth), always as a to-many relation — a list-only ref has one
 * construction site and no arity branch. A key that resolves to neither a
 * declared relationship nor a synthetic one is **rejected** (`_count` is the
 * one allowlisted exception, scoped separately — see #1082's "Out of scope"),
 * restoring this module's own denial rule for the one key shape that used to
 * fail open.
 *
 * **A `where`/`orderBy` a caller nests inside an `include` entry is validated
 * against the RELATED list, before it is AND-folded (issue #1092).** Before
 * this, the AND-fold below merged a caller's nested `where` with the access
 * filter and passed the result through unexamined — a key naming a field the
 * session cannot read reached Prisma, a probing oracle over exactly the
 * fields #915 exists to close one level up. `validateQueryKeys`/
 * `validateQueryFieldReadAccess` (`query-validation.ts`, #912/#915) are
 * reused as-is, called here against `relatedConfig` instead of the current
 * list — the same two checks the top-level `where`/`orderBy` already gets.
 * The one addition this position needs: an unresolved key is tried against
 * `resolveSyntheticReverseRelation` (via `validateQueryKeys`'s
 * `resolveSyntheticRelation` hook) before being rejected, so a nested
 * predicate naming a synthetic back-relation resolves rather than throwing.
 *
 * Those two checks only reach the entry's OWN top-level keys. A relation
 * quantifier (`some`/`every`/`none`/`is`/`isNot`) nested inside that `where`
 * names a list one hop further away, which needs the same treatment the
 * top-level `where` already gets from `buildAccessScopedWhere` (#916,
 * below): scope it by THAT list's own `query` access and check its fields'
 * read access, recursing through every further hop. Skipping this for a
 * to-many entry would just move #1092's oracle one hop further out instead
 * of closing it — `buildAccessScopedWhere` is called on `requestedEntry.where`
 * before the AND-fold, with its own `resolveSyntheticRelation` param (below)
 * so a synthetic key stays resolved at this deeper level too.
 */

/** The structured (object) form of a relation include entry — caller/fold-supplied or produced by this module. */
type IncludeEntryObject = {
  where?: PrismaFilter
  include?: Record<string, unknown>
  take?: number
  orderBy?: PrismaFilter | PrismaFilter[]
  skip?: number
}

/** A plain object — excludes `null` and arrays, which `typeof x === 'object'` alone would admit. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Narrow an unknown include value to the structured object form (vs bare `true`
 * or any other primitive). Caller-supplied includes arrive untyped at the
 * runtime boundary: narrow to a plain object first, then validate each field's
 * own type before trusting it, rather than casting the whole value wholesale.
 *
 * A numeric `take` on a to-many relation include (a caller-supplied row bound,
 * issue #752), and a caller-supplied `orderBy`/`skip` (#851), are carried
 * through the same way: none of the three can ever widen the result past the
 * access `where` — they only narrow or reorder rows the access filter already
 * admits — so preserving them is access-neutral.
 */
function asEntryObject(value: unknown): IncludeEntryObject | null {
  if (!isPlainObject(value)) return null
  const { where, include, take, orderBy, skip } = value
  const entry: IncludeEntryObject = {}
  if (isPlainObject(where)) entry.where = where
  if (isPlainObject(include)) entry.include = include
  if (typeof take === 'number') entry.take = take
  if (isPlainObject(orderBy) || Array.isArray(orderBy)) {
    entry.orderBy = orderBy as PrismaFilter | PrismaFilter[]
  }
  if (typeof skip === 'number') entry.skip = skip
  return entry
}

/**
 * AND-combine an access `where` with a caller-supplied nested `where`.
 *
 * The access filter is authoritative: the caller's filter may only NARROW the
 * result further, never widen past what access permits. We therefore wrap both
 * in a Prisma `AND` so neither can override the other.
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
 * One relation's recorded access filter, or an outright denial — see the
 * module doc's "To-one relations" section. `kind: 'scoped'` is to-one only
 * (a to-many filter is attached as Prisma `where` instead, never recorded
 * here); `kind: 'denied'` is recorded for BOTH arities (issue #1103) — a
 * to-many relation has no `where`-based way to record "zero rows, and the
 * key itself absent" either, so it shares the same post-query mechanism a
 * denied to-one already used.
 */
export type ToOneAccessFilterEntry =
  { kind: 'scoped'; relatedListName: string; accessWhere: PrismaFilter } | { kind: 'denied' }

/**
 * Which relations, at which nesting level of an `include`, need a post-query
 * fixup rather than a Prisma-side `where` — a to-one relation whose related
 * list's `query` access resolved to a filter (`kind: 'scoped'`) or a denial
 * (`kind: 'denied'`), Prisma cannot express either as a nested `where` on a
 * to-one include; a to-many relation whose related list denies `query`
 * access outright (`kind: 'denied'` only — a to-many filter is attached as
 * `where` and never reaches this tree) is dropped from `include` entirely,
 * so nothing marks its key present in the raw row either (issue #1103).
 * `resolveToOneAccessVisibility` consumes this tree; `filterReadableFields`
 * (`field-visibility.ts`) applies its result — forcing a denied key to `null`
 * for a to-one relation, `[]` for a to-many one.
 */
export type ToOneAccessFilterTree = {
  /** Relation keys at THIS level needing a post-query fixup. */
  filters: Record<string, ToOneAccessFilterEntry>
  /** Per-key trees for relations present in the include for other reasons, whose own nested include may contain further filters. */
  nested: Record<string, ToOneAccessFilterTree>
}

export function emptyToOneAccessFilterTree(): ToOneAccessFilterTree {
  return { filters: {}, nested: {} }
}

function isToOneAccessFilterTreeEmpty(tree: ToOneAccessFilterTree): boolean {
  return Object.keys(tree.filters).length === 0 && Object.keys(tree.nested).length === 0
}

/**
 * Whether a relationship field is to-one (at most one related row) rather
 * than to-many. Exported so `field-visibility.ts` can pick the same `null`
 * (to-one) vs `[]` (to-many) shape for a denied relation's forced value
 * (issue #1103) that this module used to decide whether to record the
 * denial in the first place — one source of truth for arity, not two.
 */
export function isToOneRelationship(fieldConfig: FieldConfig): boolean {
  return !('many' in fieldConfig && fieldConfig.many === true)
}

/**
 * Build the access-scoped `include` for exactly the relations a read
 * requested, recursing only into branches `requestedInclude` itself names.
 *
 * For each key in `requestedInclude`:
 * - A declared field that isn't a relationship (scalar, virtual, …) → access
 *   control does not govern it; passed through unchanged (a virtual key is
 *   stripped later by `stripVirtualFieldsFromInclude`, #628).
 * - Not declared at all → resolved via `resolveSyntheticReverseRelation`
 *   (the synthetic-back-relation case above); `_count` is passed through
 *   unchanged (unscoped by design, see #1082's "Out of scope"); anything
 *   else throws `UndeclaredIncludeKeyError` rather than reaching the
 *   database unscoped.
 * - A declared relationship whose related list's `query` access denies it
 *   (`=== false`) → dropped entirely, no matter what the request asked for
 *   nested beneath it (#566): the caller chooses *which* relations, access
 *   control chooses *whether* and *with what filter*. This denial is also
 *   recorded in `toOneAccessFilters` (`kind: 'denied'`), for either arity, so
 *   `filterReadableFields` can still surface an explicit `null` (to-one,
 *   issue #974) or `[]` (to-many, issue #1103) for it rather than an absent
 *   key.
 * - Otherwise, for a to-**many** relation → the access `where` is
 *   AND-combined with any caller-supplied nested `where` (never replaced —
 *   the other half of #566), and a caller-supplied `take` rides through
 *   unchanged (#752). For a to-**one** relation → the access filter (if any)
 *   is recorded in `toOneAccessFilters` instead of attached as `where`,
 *   because Prisma only accepts a nested `where` on a to-many include
 *   (issue #974) — the entry itself never carries a `where` for a to-one key.
 * - Either way — the "One hop" rule (ADR-0026) — nested relations are scoped
 *   ONLY if `requestedInclude` itself named a nested `include` here. A bare
 *   relation (or one with no nested `include`) fetches its own columns and
 *   stops: no recursive call, no access evaluation on anything beneath it.
 *
 * **Depth is a cost limit, not a cycle guard (ADR-0026).** A `requestedInclude`
 * is always a finite literal — the caller's own object, or
 * `foldDeclaredDependencies`'s already-cycle-guarded fold — so this recursion
 * cannot loop unboundedly on its own; nothing here walks the relationship
 * graph unprompted. `READ_INCLUDE_MAX_DEPTH` still bounds how deep a request
 * may reach, fail-closed per ADR-0022: a request naming anything at or past
 * the cap throws `AccessScopeDepthExceededError` rather than silently
 * returning less than what was asked for.
 */
export async function buildAccessScopedInclude(
  requestedInclude: Record<string, unknown>,
  fieldConfigs: Record<string, FieldConfig>,
  args: {
    session: Session | null
    context: AccessContext
  },
  config: OpenSaasConfig,
  listKey: string,
  depth: number = 0,
): Promise<{ include: Record<string, unknown>; toOneAccessFilters: ToOneAccessFilterTree }> {
  const requestedKeys = Object.keys(requestedInclude)
  if (depth >= READ_INCLUDE_MAX_DEPTH && requestedKeys.length > 0) {
    throw new AccessScopeDepthExceededError(listKey, requestedKeys[0], depth)
  }

  const result: Record<string, unknown> = {}
  const toOneAccessFilters = emptyToOneAccessFilterTree()

  for (const [relationName, requestedValue] of Object.entries(requestedInclude)) {
    // A caller can explicitly opt a relation OUT of a Prisma include with
    // `false` (its `Include` type allows a bare `boolean`), or end up with an
    // `undefined` value from a conditionally-built object
    // (`{ posts: cond ? true : undefined }`) — Prisma treats both the same as
    // the key being absent. Treat them identically here too, before this key
    // ever reaches access evaluation: an explicitly-disabled relation was
    // never actually requested, so it must not be evaluated, dropped as
    // "denied", or recorded as needing a post-query fixup (issue #1103 code
    // review) — any of those would surface a value (`[]`/`null`) for a key
    // the caller deliberately excluded.
    if (requestedValue === false || requestedValue === undefined) continue

    const fieldConfig = fieldConfigs[relationName]
    const isDeclaredRelationship =
      fieldConfig?.type === 'relationship' && 'ref' in fieldConfig && !!fieldConfig.ref

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
    let relatedConfig: { listName: string; listConfig: ListConfig<any> } | null
    let isToOne: boolean

    if (isDeclaredRelationship) {
      relatedConfig = getRelatedListConfig(fieldConfig.ref as string, config)
      if (!relatedConfig) continue
      isToOne = isToOneRelationship(fieldConfig)
    } else if (fieldConfig) {
      // A declared field that is not a relationship — access control does
      // not govern it here; passed through unchanged.
      result[relationName] = requestedValue
      continue
    } else if (relationName === '_count') {
      // Unscoped by design (#1082's "Out of scope") — a caller `_count`
      // leaks related-row counts regardless of the related list's `query`
      // access. Same bug class, its own fix, tracked separately.
      result[relationName] = requestedValue
      continue
    } else {
      const synthetic = resolveSyntheticReverseRelation(relationName, listKey, config)
      if (!synthetic) {
        throw new UndeclaredIncludeKeyError(listKey, relationName)
      }
      relatedConfig = { listName: synthetic.sourceListName, listConfig: synthetic.sourceListConfig }
      // Always to-many — a list-only ref has one construction site and no
      // arity branch, and one-to-one is structurally impossible for it.
      isToOne = false
    }

    const queryAccess = relatedConfig.listConfig.access?.operation?.query
    const accessResult = await checkAccess(queryAccess, {
      session: args.session,
      context: args.context,
    })

    if (accessResult === false) {
      // Recorded for either arity (issue #1103) — a to-many relation is
      // dropped from `include` here exactly like a to-one one, and needs the
      // same post-query fixup so its key comes back `[]`, not silently
      // absent from the row.
      toOneAccessFilters.filters[relationName] = { kind: 'denied' }
      continue
    }

    const accessWhere = typeof accessResult === 'object' ? accessResult : undefined
    const requestedEntry = asEntryObject(requestedValue)

    // #1092 — a nested `where`/`orderBy` gets the same #912/#915 checks the
    // top-level `where`/`orderBy` already gets, resolved against the RELATED
    // list (`relatedConfig`) rather than the current one, and run only once
    // the relation is known to be accessible at all (same ordering reason as
    // the top-level checks: don't leak a field's name/read-gating status to a
    // caller who has zero access to the relation to begin with).
    const resolveSyntheticRelation = (
      key: string,
      fromListName: string,
    ): SyntheticRelationTarget | null => {
      const synthetic = resolveSyntheticReverseRelation(key, fromListName, config)
      return synthetic
        ? { listConfig: synthetic.sourceListConfig, listName: synthetic.sourceListName }
        : null
    }
    validateQueryKeys({
      where: requestedEntry?.where,
      orderBy: requestedEntry?.orderBy,
      listConfig: relatedConfig.listConfig,
      listName: relatedConfig.listName,
      config,
      isSudo: false,
      resolveSyntheticRelation,
    })
    await validateQueryFieldReadAccess({
      where: requestedEntry?.where,
      orderBy: requestedEntry?.orderBy,
      listConfig: relatedConfig.listConfig,
      listName: relatedConfig.listName,
      session: args.session,
      context: args.context,
      isSudo: false,
    })

    // The two checks above only reach the entry's own top-level keys — a
    // relation quantifier (`some`/`every`/`none`/`is`/`isNot`) nested inside
    // this `where` names a DEEPER related list, which needs the same
    // treatment the top-level `where` already gets from `buildAccessScopedWhere`
    // (#916): scope it by that deeper list's own `query` access and check ITS
    // fields' read access, recursing through every further hop. Only for
    // to-many — a to-one entry never carries `requestedEntry.where` through to
    // Prisma at all (see below), so there is nothing here to scope.
    const scopedRequestedWhere =
      !isToOne && requestedEntry?.where !== undefined
        ? ((await buildAccessScopedWhere(
            requestedEntry.where,
            relatedConfig.listConfig,
            relatedConfig.listName,
            config,
            args,
            resolveSyntheticRelation,
          )) as PrismaFilter)
        : requestedEntry?.where

    let nestedInclude: Record<string, unknown> | undefined
    let nestedToOneFilters: ToOneAccessFilterTree | undefined
    if (requestedEntry?.include) {
      const nested = await buildAccessScopedInclude(
        requestedEntry.include,
        relatedConfig.listConfig.fields,
        args,
        config,
        relatedConfig.listName,
        depth + 1,
      )
      nestedInclude = nested.include
      nestedToOneFilters = nested.toOneAccessFilters
    }

    const entry: IncludeEntryObject = {}
    if (isToOne) {
      if (accessWhere) {
        toOneAccessFilters.filters[relationName] = {
          kind: 'scoped',
          relatedListName: relatedConfig.listName,
          accessWhere,
        }
      }
    } else {
      const mergedWhere = andWhere(accessWhere, scopedRequestedWhere)
      if (mergedWhere) entry.where = mergedWhere
      if (requestedEntry?.take !== undefined) entry.take = requestedEntry.take
      if (requestedEntry?.orderBy !== undefined) entry.orderBy = requestedEntry.orderBy
      if (requestedEntry?.skip !== undefined) entry.skip = requestedEntry.skip
    }
    if (nestedInclude && Object.keys(nestedInclude).length > 0) entry.include = nestedInclude
    if (nestedToOneFilters && !isToOneAccessFilterTreeEmpty(nestedToOneFilters)) {
      toOneAccessFilters.nested[relationName] = nestedToOneFilters
    }

    result[relationName] = Object.keys(entry).length > 0 ? entry : true
  }

  return { include: result, toOneAccessFilters }
}

/**
 * One relation's resolved post-query visibility — see
 * `resolveToOneAccessVisibility`. `kind: 'visible'` (an existence check
 * against a set of ids) only ever arises for a to-one relation, since only a
 * to-one `kind: 'scoped'` filter entry produces one; `kind: 'denied'` passes
 * straight through unresolved for either arity.
 */
export type ToOneVisibility = { kind: 'denied' } | { kind: 'visible'; ids: ReadonlySet<string> }

/** The resolved counterpart to {@link ToOneAccessFilterTree}, produced by `resolveToOneAccessVisibility`. */
export type ToOneAccessVisibilityTree = {
  filters: Record<string, ToOneVisibility>
  nested: Record<string, ToOneAccessVisibilityTree>
}

export function emptyToOneAccessVisibilityTree(): ToOneAccessVisibilityTree {
  return { filters: {}, nested: {} }
}

/**
 * Resolve a `ToOneAccessFilterTree` against the RAW rows Prisma already
 * fetched (unscoped for the flagged to-one relations — see
 * `buildAccessScopedInclude`) into the set of related ids the session may
 * actually see, one batched `id IN (...)` existence check per (relation,
 * nesting level) across every row in `items` — never once per row.
 *
 * For each `filters` entry at a level:
 * - `kind: 'denied'` → carried straight through; no query, nothing to check.
 * - `kind: 'scoped'` → every id present at this key across ALL of `items` is
 *   collected first (an empty set skips the query entirely — nothing to
 *   check), then ONE `findMany` through the RAW `prisma` client (not
 *   `context.db`, which would re-evaluate the same access-control function a
 *   second time) asks which of those ids also satisfy `accessWhere` — the
 *   exact `PrismaFilter` `checkAccess` already produced, handed to Prisma
 *   unmodified rather than interpreted by hand.
 *
 * Recurses into `nested` by flattening the related items reached through
 * each key across every row in `items` (a to-many hop contributes every one
 * of its rows; a to-one hop contributes its single row, if any) into the
 * next level's own `items` array, so a to-one relation nested arbitrarily
 * deep is still resolved with one batched query per node, not per parent row.
 */
export async function resolveToOneAccessVisibility(
  items: readonly unknown[],
  tree: ToOneAccessFilterTree,
  args: {
    session: Session | null
    context: AccessContext
  },
): Promise<ToOneAccessVisibilityTree> {
  const resolved = emptyToOneAccessVisibilityTree()

  for (const [key, entry] of Object.entries(tree.filters)) {
    if (entry.kind === 'denied') {
      resolved.filters[key] = { kind: 'denied' }
      continue
    }

    const ids = new Set<string>()
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const value = (item as Record<string, unknown>)[key]
      if (value && typeof value === 'object' && 'id' in value) {
        ids.add(String((value as Record<string, unknown>).id))
      }
    }

    if (ids.size === 0) {
      resolved.filters[key] = { kind: 'visible', ids: new Set() }
      continue
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic model access by list name, mirroring the rest of the read pipeline
    const model = (args.context.prisma as any)[getDbKey(entry.relatedListName)]
    const visibleRows = await model.findMany({
      where: { AND: [entry.accessWhere, { id: { in: [...ids] } }] },
      select: { id: true },
    })
    const visibleIds = new Set<string>(
      Array.isArray(visibleRows) ? visibleRows.map((row: { id: unknown }) => String(row.id)) : [],
    )
    resolved.filters[key] = { kind: 'visible', ids: visibleIds }
  }

  for (const [key, nestedTree] of Object.entries(tree.nested)) {
    const nestedItems: unknown[] = []
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const value = (item as Record<string, unknown>)[key]
      if (Array.isArray(value)) nestedItems.push(...value)
      else if (value && typeof value === 'object') nestedItems.push(value)
    }
    resolved.nested[key] = await resolveToOneAccessVisibility(nestedItems, nestedTree, args)
  }

  return resolved
}

/**
 * Scope every relation filter (`some`/`every`/`none`/`is`/`isNot`) nested in a
 * caller's `where` by the related list's own `query` access — the `where`
 * counterpart to `buildAccessScopedInclude` above, closing #916 (the
 * "unclosed half of ADR-0022"). `include` and `where` are fundamentally
 * different requests (which relations come back, vs. which parent rows
 * match), so this is a distinct function, but it shares every primitive that
 * matters: `checkAccess`/`getRelatedListConfig` (the same access-evaluation
 * calls `buildAccessScopedInclude` makes), `andWhere` (the same AND-fold), and
 * `resolveQueryField`/`LOGICAL_OPERATORS`/`RELATION_QUANTIFIERS`/
 * `walkWhereReadAccess` (the same shape-recognition and field-read check
 * `query-validation.ts` already uses for #912/#915) — there is no second,
 * parallel implementation of any of those decisions.
 *
 * For each relationship key found (at any depth — the walk recurses through
 * `AND`/`OR`/`NOT` and through every hop of a chain):
 * - Not a declared relationship, or the key #912 already rejected (this walk
 *   runs strictly after that check) → passed through unchanged.
 * - The related list's `query` access denies it (`=== false`) → THROWS
 *   `RelationFilterAccessDeniedError`. Unlike `buildAccessScopedInclude`'s
 *   silent drop, this is a loud failure: a `where` predicate has no neutral
 *   "not requested" outcome the way a missing `include` key does, so a
 *   silently-empty match would itself be a distinguishable signal (ADR-0022).
 * - Otherwise → the access filter (if any) is AND-combined into the relation
 *   quantifier's nested clause (never replacing the caller's own condition,
 *   mirroring `andWhere`'s include-side contract), keys inside that nested
 *   clause are checked against the RELATED list's field-level `read` access
 *   (`walkWhereReadAccess`, closing #915's stated gap for this path), and the
 *   walk recurses into the related list's own fields for a further hop.
 *
 * One quantifier is deliberately conservative rather than exactly precise:
 * folding the access filter into `every`'s nested clause with a plain AND
 * makes `every` require every related row to be BOTH access-visible AND
 * matching, not "every access-visible row matches" (the latter needs a
 * `NOT`/`OR` transform this does not attempt). The conservative version can
 * only reject a query that the precise version would allow — it never
 * widens what a caller can learn — so it is the safe direction to ship; a
 * caller can observe that an inaccessible related row exists (an `every`
 * that "should" pass instead fails), but never that row's field values,
 * which is the property this ticket exists to close.
 *
 * A quantifier's value of literal `null` (`is: null`/`isNot: null`, a to-one
 * relation's existence check) is passed through untouched rather than folded:
 * it names no fields to read-check or scope, and AND-folding an access filter
 * into it would silently invert the caller's own predicate (see the inline
 * comment at that branch).
 *
 * `resolveSyntheticRelation` (#1092/#1108) extends this to a key that
 * resolves to a synthetic back-relation (#1082) rather than a declared
 * field, recursing against its SOURCE list. Only `buildAccessScopedInclude`
 * passes it, for the include-nested `where` position; the top-level `where`
 * this function was originally built for (`context/index.ts`) omits it, so
 * a synthetic key there is unaffected — matching #1092's own scope, which
 * deliberately left the top-level checks unchanged.
 */
export async function buildAccessScopedWhere(
  where: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listName: string,
  config: OpenSaasConfig,
  args: {
    session: Session | null
    context: AccessContext
  },
  // #1092/#1108 — the include-nested position's own addition, exactly
  // mirroring `validateQueryKeys`'s `resolveSyntheticRelation` (see that
  // module's doc comment): every top-level `where` caller omits this, so
  // top-level behavior is unchanged.
  resolveSyntheticRelation?: ResolveSyntheticRelation,
): Promise<unknown> {
  if (where === null || typeof where !== 'object') return where

  if (Array.isArray(where)) {
    return Promise.all(
      where.map((entry) =>
        buildAccessScopedWhere(entry, listConfig, listName, config, args, resolveSyntheticRelation),
      ),
    )
  }

  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (LOGICAL_OPERATORS.has(key)) {
      result[key] = await buildAccessScopedWhere(
        value,
        listConfig,
        listName,
        config,
        args,
        resolveSyntheticRelation,
      )
      continue
    }

    const resolved = resolveQueryField(key, listConfig.fields)
    // A synthetic back-relation (#1082) carries no `ref` of its own to
    // follow — its "related" list for recursion is the SOURCE list it
    // stands for, given directly by the resolver, not `getRelatedListConfig`.
    const related = resolved?.isRelationship
      ? getRelatedListConfig(resolved.fieldConfig.ref, config)
      : !resolved
        ? (() => {
            const synthetic = resolveSyntheticRelation?.(key, listName)
            return synthetic
              ? { listConfig: synthetic.listConfig, listName: synthetic.listName }
              : null
          })()
        : null

    if (!related || value === null || typeof value !== 'object' || Array.isArray(value)) {
      result[key] = value
      continue
    }

    const queryAccess = related.listConfig.access?.operation?.query
    const accessResult = await checkAccess(queryAccess, {
      session: args.session,
      context: args.context,
    })

    if (accessResult === false) {
      throw new RelationFilterAccessDeniedError(listName, key, related.listName)
    }

    const accessWhere = typeof accessResult === 'object' ? accessResult : undefined
    const relationEntries = Object.entries(value as Record<string, unknown>)
    const hasQuantifier = relationEntries.some(([k]) => RELATION_QUANTIFIERS.has(k))

    if (hasQuantifier) {
      const nestedEntry: Record<string, unknown> = {}
      for (const [quantifier, quantifierValue] of relationEntries) {
        if (!RELATION_QUANTIFIERS.has(quantifier)) {
          nestedEntry[quantifier] = quantifierValue
          continue
        }
        if (quantifierValue === null) {
          // `is: null` / `isNot: null` tests EXISTENCE of a to-one relation,
          // not its fields — there is nothing to read-check or scope, and
          // AND-folding the access filter in here would silently invert the
          // caller's predicate: `is: null` ("has no related row") would
          // become `is: <accessWhere>` ("has a related row matching the
          // filter"), the opposite of what was asked. Passed through as-is.
          nestedEntry[quantifier] = null
          continue
        }
        await walkWhereReadAccess(quantifierValue, related.listConfig, related.listName, args)
        const scopedNested = await buildAccessScopedWhere(
          quantifierValue,
          related.listConfig,
          related.listName,
          config,
          args,
          resolveSyntheticRelation,
        )
        nestedEntry[quantifier] = accessWhere
          ? andWhere(accessWhere, scopedNested as PrismaFilter | undefined)
          : scopedNested
      }
      result[key] = nestedEntry
    } else {
      // Prisma's direct-nesting to-one form: the whole value IS the nested
      // WHERE clause, with no `is` wrapper. Only wrap it in `is` when there is
      // an access filter to fold in — an unwrapped value that needs no fold
      // (fully-allowed related list) is returned exactly as the caller wrote
      // it, so an already-permitted query is not perturbed by this pass.
      await walkWhereReadAccess(value, related.listConfig, related.listName, args)
      const scopedNested = await buildAccessScopedWhere(
        value,
        related.listConfig,
        related.listName,
        config,
        args,
        resolveSyntheticRelation,
      )
      result[key] = accessWhere
        ? { is: andWhere(accessWhere, scopedNested as PrismaFilter | undefined) }
        : scopedNested
    }
  }

  return result
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
