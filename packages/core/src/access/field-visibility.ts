import type { Session, AccessContext } from './types.js'
import type { OpenSaasConfig, FieldConfig, ListConfig } from '../config/types.js'
import { getRelatedListConfig, resolveSyntheticReverseRelation } from './engine.js'
import { checkFieldAccess } from './field-access.js'
import { RESOLVE_CHAIN_MAX_LENGTH } from './depth-limits.js'
import { ResolveOutputCycleError } from './errors.js'
import type { DependencyAdditions } from './declared-dependencies.js'
import {
  getDeclaredDependencyNames,
  getListDependencies,
  noDependencyAdditions,
} from './declared-dependencies.js'
import type { FieldSelectionScope } from '../query/index.js'
import type { ToOneAccessVisibilityTree, CountAccessDenialTree } from './access-filter.js'
import {
  emptyToOneAccessVisibilityTree,
  isToOneRelationship,
  emptyCountAccessDenialTree,
} from './access-filter.js'
// NOTE: `context/index.ts` imports `filterReadableFields` from this module
// (via the `access/index.ts` barrel) — this is an intentional cyclic
// dependency, the same shape and for the same reason as the one documented in
// `context/write-pipeline.ts`. `buildDbDelegate` is only INVOKED when a
// `resolveOutput` hook actually runs (never during module evaluation), so by
// the time it runs the export is fully initialised.
import { buildDbDelegate } from '../context/index.js'

/**
 * Field Visibility — phase 2 of the two-phase read (post-query).
 *
 * This module runs after the database query against the returned rows. It
 * strips fields the session cannot read (via the canonical `checkFieldAccess`
 * evaluator in `field-access.ts`), runs `resolveOutput` hooks, and computes
 * virtual fields. None of this can move into phase 1: virtual fields are
 * computed in JavaScript and field access can depend on the fetched row.
 *
 * A computed field — any field carrying a `resolveOutput` hook, virtual or
 * not — is produced only where the read is going to return it (ADR-0027). A
 * fragment `query`'s own field selection is the only thing that restricts a
 * level this way; a bare or `include`-based read, and any relation reached
 * purely to satisfy a `needs` declaration, still compute every field, as
 * before. A field the read is not going to return does no work at all —
 * neither its read-access evaluation nor its hook. The projection-aware skip
 * below shows this rule at each of the two places it applies.
 *
 * Phase 1 (pre-query row/relation scoping) lives in `access-filter.ts`. See
 * `docs/adr/0001-access-control-is-a-two-phase-read.md` and the access-control
 * glossary in `CONTEXT.md`.
 *
 * **To-one relation nulling (issue #974).** A to-one relation whose related
 * list's `query` access resolves to a filter cannot be scoped by Prisma's own
 * `where` (it only accepts one on a to-many include — see the "To-one
 * relations" section of `access-filter.ts`'s module doc), so
 * `buildAccessScopedInclude` fetches it unscoped and hands this module a
 * `ToOneAccessVisibilityTree` — already resolved, via one batched existence
 * check per relation across the whole read, by
 * `resolveToOneAccessVisibility`. This module is where that resolution
 * actually becomes the caller-visible `null`: a `kind: 'denied'` key is
 * forced to `null` even though it was never fetched at all (the key is
 * absent from `workingItem`), and a `kind: 'visible'` key's fetched row is
 * nulled out unless its id survived the existence check — in both branches,
 * before any field-level access check or `resolveOutput` hook runs, so the
 * rest of the pipeline sees exactly what a denied to-one read has always
 * meant elsewhere: `null`, never a thrown error.
 *
 * **A denied to-many relation is forced to `[]`, the same way (issue
 * #1103).** `buildAccessScopedInclude` drops a to-many relation from
 * `include` on the same outright `query` denial as a to-one one, and records
 * the same `kind: 'denied'` entry for it. The key is therefore just as absent
 * from `workingItem` as a denied to-one key, and the fix is the same fixup
 * loop — it now forces the key present using the field's own declared
 * arity: `null` for a to-one relation (unchanged), `[]` for a to-many one,
 * rather than leaving a to-many key silently missing where the fragment
 * API's `ResultOf` type (`query/index.ts`) promises an array.
 *
 * **`_count` denial injection (issue #1087).** A caller-supplied `_count.select`
 * key whose related list denies `query` access outright is omitted from the
 * select `buildAccessScopedInclude` sends to Prisma — there is no way to ask
 * Prisma for a guaranteed `0`, and no query is needed to know one (unlike the
 * to-one existence check above). This module is where that becomes the
 * caller-visible `0`: every key in a `CountAccessDenialTree` at this level is
 * written into `filtered._count` as `0`, whether or not `_count` came back
 * from the database at all — a count is a session-relative value, and `0` is
 * what "no visible rows" means for it, never an absent key.
 */

type ResolveOutputHookRuntime = (args: {
  operation: 'query'
  value: unknown
  item: Record<string, unknown>
  listKey: string
  fieldName: string
  context: AccessContext
}) => unknown | Promise<unknown>

type FieldVisibilityArgs = {
  session: Session | null
  context: AccessContext & { _isSudo?: boolean }
}

/**
 * Derive the context passed to a single `resolveOutput` hook invocation: a
 * NEW context object whose `_resolveOutputChain` extends the caller's chain
 * with this hook's own `(list, field)` link. The chain is never mutated in
 * place — this is what lets concurrent hook invocations (e.g. sibling rows in
 * a to-many relation, filtered via `Promise.all`) each see their own chain
 * rather than racing on one shared value (ADR-0023).
 *
 * A plain `{ ...context, _resolveOutputChain }` spread is not enough on its
 * own: `context.db`'s operations capture their `context` at construction
 * (see `populateDbDelegate`), so a hook that calls `context.db.x.findMany(…)`
 * would otherwise reach the ORIGINAL closures — bound to the ORIGINAL
 * context — and its read would silently fall back to the un-extended chain,
 * defeating the cycle guard entirely. Rebuilding `db` via `buildDbDelegate`
 * against the derived context is what makes a hook-issued read's own nested
 * hooks actually observe the extended chain.
 *
 * `config` is required to rebuild `db`; callers that cannot supply one (e.g. a
 * narrow unit test exercising field access in isolation) still get a correct
 * chain for THIS hook's own cycle/cap check, but a read that hook issues
 * would not carry the chain any further — those callers are not exercising
 * the read pipeline, so there is nothing for it to reach.
 */
function deriveResolveOutputContext(
  context: AccessContext & { _isSudo?: boolean },
  link: { listKey: string; fieldKey: string },
  config: OpenSaasConfig | undefined,
): AccessContext & { _isSudo?: boolean } {
  const derived: AccessContext & { _isSudo?: boolean } = {
    ...context,
    _resolveOutputChain: [...context._resolveOutputChain, link],
  }
  if (config) {
    derived.db = buildDbDelegate(config, context.ormHandle, derived)
  }
  return derived
}

/**
 * The core Field Visibility step for a single field: check read access and, if
 * granted, produce the output value by running any `resolveOutput` hook.
 *
 * This is the single place the "check read access → skip if denied →
 * resolveOutput" sequence lives. Both the regular-field branch and the
 * virtual-field branch of `filterReadableFields` call it, so the sequence is
 * never duplicated. Returns `{ readable: false }` when the field must be omitted
 * from the result.
 *
 * `accessItem` is the row used to evaluate field access; `hookItem` is the
 * object passed to the hook as `item`. For a stored field, both are
 * `workingItem` (the row's own stored/fetched columns). For a virtual field,
 * `hookItem` is `computedFieldItem` instead — the same stored columns with
 * every skipped-or-denied key removed — so it never sees another computed
 * field's resolved value (ADR-0027).
 */
async function resolveReadableFieldValue(params: {
  fieldConfig: FieldConfig | undefined
  fieldName: string
  value: unknown
  accessItem: Record<string, unknown>
  hookItem: Record<string, unknown>
  listKey: string | undefined
  args: FieldVisibilityArgs
  config: OpenSaasConfig | undefined
}): Promise<{ readable: false } | { readable: true; value: unknown }> {
  const { fieldConfig, fieldName, value, accessItem, hookItem, listKey, args, config } = params

  const canRead = await checkFieldAccess(fieldConfig?.access, 'read', {
    ...args,
    item: accessItem,
  })

  if (!canRead) {
    return { readable: false }
  }

  if (fieldConfig?.hooks?.resolveOutput && listKey) {
    // The hook is erased to this runtime shape here; at the actual call it
    // receives the value typed for its own field.
    const hook = fieldConfig.hooks.resolveOutput as unknown as ResolveOutputHookRuntime
    const link = { listKey, fieldKey: fieldName }
    const chain = args.context._resolveOutputChain

    // Cycle guard: a hook that would re-enter a (list, field) pair already on
    // its own chain cannot terminate — refuse loudly rather than recurse
    // until the process runs out of memory (issue #844, ADR-0023).
    const alreadyOnChain = chain.some(
      (entry) => entry.listKey === link.listKey && entry.fieldKey === link.fieldKey,
    )
    if (alreadyOnChain) {
      throw new ResolveOutputCycleError([...chain, link])
    }

    // Cost cap: a chain this long is refused only as a cost limit, never a
    // correctness one — an acyclic chain that works today can legitimately
    // reach this. Omit the field and warn instead of throwing.
    if (chain.length >= RESOLVE_CHAIN_MAX_LENGTH) {
      const path = [...chain, link].map((entry) => `${entry.listKey}.${entry.fieldKey}`).join(' → ')
      console.warn(
        `resolveOutput: omitting "${listKey}.${fieldName}" — its resolve chain exceeded ` +
          `RESOLVE_CHAIN_MAX_LENGTH (${RESOLVE_CHAIN_MAX_LENGTH}): ${path}. This is a cost limit, ` +
          `not an access denial.`,
      )
      return { readable: false }
    }

    const resolved = await Promise.resolve(
      hook({
        value,
        operation: 'query',
        fieldName,
        listKey,
        item: hookItem,
        context: deriveResolveOutputContext(args.context, link, config),
      }),
    )
    return { readable: true, value: resolved }
  }

  return { readable: true, value }
}

export async function filterReadableFields<T extends Record<string, unknown>>(
  item: T,
  fieldConfigs: Record<string, FieldConfig>,
  args: {
    session: Session | null
    context: AccessContext & { _isSudo?: boolean }
  },
  config?: OpenSaasConfig,
  depth: number = 0,
  listKey?: string,
  // Relation keys the dependency widening added at THIS level (ADR-0051),
  // and the same tree for each nested relation reached via a caller-named
  // branch. Stripped from `filtered` right before it is returned — after
  // resolveOutput has had a chance to read them — so a declared dependency
  // never widens what the caller receives.
  additions: DependencyAdditions = noDependencyAdditions(),
  // The fragment scope this level was reached under (ADR-0027, see module doc
  // above), and the same tree one level down for each nested relation.
  selection?: FieldSelectionScope,
  // Resolved to-one existence checks at THIS level (issue #974, see module
  // doc above), and the same tree one level down for each nested relation —
  // regardless of that relation's own arity, since a filtered to-one can sit
  // beneath a to-many hop.
  toOneVisibility: ToOneAccessVisibilityTree = emptyToOneAccessVisibilityTree(),
  // `_count.select` keys denied outright at THIS level (issue #1087, see
  // module doc above), and the same tree one level down for each nested
  // relation whose own nested include named a further `_count`.
  countDenials: CountAccessDenialTree = emptyCountAccessDenialTree(),
): Promise<Partial<T>> {
  const filtered: Record<string, unknown> = {}

  // Multi-column fields (e.g. storage image()/file() in Keystone-parity mode)
  // back several physical columns rather than one. Before the per-field pass,
  // assemble each such field's logical value from its raw columns and remove the
  // raw columns from the working row, so only the assembled value is exposed
  // (the raw per-part columns never leak). The assembled value then flows
  // through the normal read-access + resolveOutput path under the field's own
  // key. See ADR-0006.
  const workingItem: Record<string, unknown> = { ...item }
  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    if (!fieldConfig.assembleColumns || !fieldConfig.getColumnNames) continue
    const columnNames = fieldConfig.getColumnNames(fieldName)
    // Only assemble when the raw columns are present in the row (i.e. they were
    // selected); otherwise leave the field absent from the result.
    const hasAnyColumn = columnNames.some((name) => name in workingItem)
    if (!hasAnyColumn) continue
    const assembled = fieldConfig.assembleColumns(fieldName, workingItem)
    for (const name of columnNames) {
      delete workingItem[name]
    }
    workingItem[fieldName] = assembled
  }

  // Keys denied by field-level read access during the pass below — as opposed
  // to a key merely skipped by `selection` or held back only for the
  // widening's own strip. Tracked separately because a denied key must stay
  // invisible to a computed field's hook (below), while a declared key must
  // stay VISIBLE to one — that is the entire point of declaring it (ADR-0025)
  // — even though `selection` above skipped adding it to `filtered` because
  // the caller's fragment never asked for it.
  const accessDeniedKeys = new Set<string>()

  // This list's actual system fields, from the emitted table (ADR-0051):
  // always readable, never field-access-checked, always visible to a hook's
  // `item`. `id` is universal; the timestamps exist only where the list
  // carries them, so a fixed triple would name columns a list does not have.
  const systemFields = new Set(
    config && listKey
      ? getListDependencies(config, listKey).systemFields
      : ['id', 'createdAt', 'updatedAt'],
  )

  // Process existing fields from the database result
  for (const [fieldName, value] of Object.entries(workingItem)) {
    const fieldConfig = fieldConfigs[fieldName]

    if (systemFields.has(fieldName)) {
      filtered[fieldName] = value
      continue
    }

    // Projection-aware skip (ADR-0027, see module doc above): a field this
    // level's fragment did not select gets no read-access check, no
    // resolveOutput, and no recursion into a relation — none of that work
    // happens for a value the read isn't going to return.
    if (selection?.fields && !selection.fields.has(fieldName)) {
      continue
    }

    // Row/relation-level access is already scoped at the DB level via
    // buildAccessScopedInclude; this only handles field-level access (hiding
    // sensitive fields).
    //
    // Deliberately uncapped: the row/relation scoping in access-filter.ts bounds
    // what gets FETCHED (a caller include past its depth cap is now a denial,
    // not a passthrough — see ADR-0022), so by the time a result reaches this
    // function it is already a finite, acyclic tree whose depth was decided at
    // the pre-query phase. Capping recursion again here independently of that
    // cap used to let a relation be scoped correctly at the DB level while
    // still returning with unfiltered fields past this function's own,
    // separately-tracked limit (issue #830).
    const isDeclaredRelationshipField =
      fieldConfig?.type === 'relationship' && 'ref' in fieldConfig && !!fieldConfig.ref
    // A synthetic back-relation (#1082) — no declared field of its own on
    // this list, so resolved by name against the owning list's relationship
    // field instead. `undefined` (not `fieldConfig`) is the signal it's
    // worth trying: a declared-but-non-relationship field (e.g. a scalar or
    // virtual) must fall through to the generic path below, unchanged.
    const synthetic =
      !isDeclaredRelationshipField && fieldConfig === undefined && config && listKey
        ? resolveSyntheticReverseRelation(fieldName, listKey, config)
        : null

    if (
      config &&
      (isDeclaredRelationshipField || synthetic) &&
      value !== null &&
      value !== undefined
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
      let relatedConfig: { listName: string; listConfig: ListConfig<any> } | null = null

      if (isDeclaredRelationshipField) {
        const canRead = await checkFieldAccess(fieldConfig?.access, 'read', {
          ...args,
          item: workingItem,
        })

        if (!canRead) {
          accessDeniedKeys.add(fieldName)
          continue
        }

        // A branch the widening added returns to nobody — it is stripped from
        // `filtered` below, and the declaring hook reads its raw rows off
        // `computedFieldItem`, never off `filtered`. Descending would run the
        // related list's own computed fields over a one-hop set that was
        // never fetched for them, so a hook reading its declared dependency
        // there dereferences `undefined` and fails the whole read. ADR-0051
        // records this as the decision: no computed field runs on a declared
        // branch.
        if (additions.keys.has(fieldName)) continue

        relatedConfig = getRelatedListConfig(fieldConfig.ref as string, config)
      } else if (synthetic) {
        // No declared field means no field-level `read` gate of its own to
        // check here — the owning list's OWN field-level access is enforced
        // by the recursive `filterReadableFields` call below, exactly as it
        // would be for a declared relationship's related rows.
        relatedConfig = {
          listName: synthetic.sourceListName,
          listConfig: synthetic.sourceListConfig,
        }
      }
      // The additions beneath THIS relation, e.g. a field on the related list
      // that declares its own `needs`. Falls back to an empty tree when the
      // widening added nothing there — the common case.
      const nestedAdditions = additions.nested[fieldName] ?? noDependencyAdditions()
      // This relation's own fragment scope, if the caller's fragment named it
      // with a nested Fragment/RelationSelector. `undefined` (a bare `true`
      // selector, or no `selection` at all) means the nested list computes
      // unrestricted — matching what naming a relation without narrowing it
      // further has always meant.
      const nestedSelection = selection?.nested[fieldName]
      // This relation's own resolved to-one visibility, if
      // `buildAccessScopedInclude` flagged anything beneath it (issue #974).
      // Falls back to empty — the common case for a relation with no
      // filtered to-one anywhere in its own nested include.
      const nestedToOneVisibility =
        toOneVisibility.nested[fieldName] ?? emptyToOneAccessVisibilityTree()
      // This key's OWN to-one existence check, if `fieldName` itself is a
      // filtered to-one relation (as opposed to one further down its tree).
      const toOneEntry = toOneVisibility.filters[fieldName]
      // This relation's own denied `_count` keys, if `buildAccessScopedInclude`
      // flagged any beneath it (issue #1087). Falls back to empty — the
      // common case for a relation with no denied `_count` anywhere in its
      // own nested include.
      const nestedCountDenials = countDenials.nested[fieldName] ?? emptyCountAccessDenialTree()

      if (relatedConfig) {
        if (Array.isArray(value)) {
          filtered[fieldName] = await Promise.all(
            value.map((relatedItem) =>
              filterReadableFields(
                relatedItem,
                relatedConfig.listConfig.fields,
                args,
                config,
                depth + 1,
                relatedConfig.listName,
                nestedAdditions,
                nestedSelection,
                nestedToOneVisibility,
                nestedCountDenials,
              ),
            ),
          )
        } else if (typeof value === 'object') {
          const relatedId = (value as Record<string, unknown>).id
          const isVisible =
            !toOneEntry || toOneEntry.kind !== 'visible' || toOneEntry.ids.has(String(relatedId))

          filtered[fieldName] = isVisible
            ? await filterReadableFields(
                value as Record<string, unknown>,
                relatedConfig.listConfig.fields,
                args,
                config,
                depth + 1,
                relatedConfig.listName,
                nestedAdditions,
                nestedSelection,
                nestedToOneVisibility,
                nestedCountDenials,
              )
            : null
        }
      } else {
        filtered[fieldName] = value
      }
      continue
    }

    // Non-relationship field, or a relationship field whose value is not
    // includable (null/undefined) — falls through to the shared helper.
    const result = await resolveReadableFieldValue({
      fieldConfig,
      fieldName,
      value,
      accessItem: workingItem,
      hookItem: workingItem,
      listKey,
      args,
      config,
    })

    if (result.readable) {
      filtered[fieldName] = result.value
    } else {
      accessDeniedKeys.add(fieldName)
    }
  }

  // Relations `buildAccessScopedInclude` denied outright (to-one: issue #974,
  // to-many: issue #1103) were never asked of Prisma at all, so `fieldName`
  // has no entry in `workingItem` and the loop above never visits it. Force
  // it present here — matching what a denied read means everywhere else in
  // the context — rather than leaving the key silently absent: `null` for a
  // to-one relation, `[]` for a to-many one. A synthetic back-relation
  // (`fieldConfig` undefined — #1082) is always to-many, the same arity
  // `buildAccessScopedInclude` assumes for it.
  for (const [fieldName, entry] of Object.entries(toOneVisibility.filters)) {
    if (entry.kind !== 'denied') continue
    if (fieldName in filtered || fieldName in workingItem) continue
    if (selection?.fields && !selection.fields.has(fieldName)) continue

    const fieldConfig = fieldConfigs[fieldName]
    const canRead = await checkFieldAccess(fieldConfig?.access, 'read', {
      ...args,
      item: workingItem,
    })

    if (!canRead) {
      accessDeniedKeys.add(fieldName)
      continue
    }

    const isToMany = !fieldConfig || !isToOneRelationship(fieldConfig)
    filtered[fieldName] = isToMany ? [] : null
  }

  // `_count.select` keys `buildAccessScopedInclude` denied outright (issue
  // #1087) were omitted from the select sent to Prisma, so `_count` may be
  // absent from `workingItem` entirely, or present but missing exactly these
  // keys. Write each denied key in as `0` — matching what a denied count has
  // always meant for the admin list view's own scoped counts — unless a
  // fragment's own selection excluded `_count` altogether, in which case
  // there is nothing to inject it into.
  if (countDenials.keys.size > 0 && !(selection?.fields && !selection.fields.has('_count'))) {
    const existingCount =
      filtered._count && typeof filtered._count === 'object'
        ? (filtered._count as Record<string, unknown>)
        : {}
    const mergedCount = { ...existingCount }
    for (const key of countDenials.keys) {
      mergedCount[key] = 0
    }
    filtered._count = mergedCount
  }

  // The item a virtual field's hook sees: stored columns and fetched
  // relations (from `workingItem`, never a resolved value — no hook's output
  // is ever written back into `workingItem`). A key is visible here if it
  // either survived into `filtered` (selected and allowed) OR is in the
  // emitted dependency set of a field this level computes — a relation the
  // widening fetched (`additions`) or a stored column the caller's projection
  // skipped but a hook named (ADR-0025, ADR-0051: that IS the point of
  // declaring it — carried for a hook, never for the caller). Everything else — field-level
  // denied, or skipped by `selection` and declared by no one — is deleted. A
  // computed field reaches for exactly its own declared dependencies and
  // nothing another field's hook produced (ADR-0027): reaching for a sibling
  // that was denied or skipped-and-undeclared finds nothing there, the same
  // as reaching for one never declared at all, and reaching for a sibling
  // that DID survive finds its raw stored form, never another hook's resolved
  // value — a virtual field computed earlier in declaration order is exactly
  // as invisible as one computed later.
  const declaredNames =
    config && listKey
      ? getDeclaredDependencyNames(config, listKey, selection?.fields)
      : new Set<string>()
  const computedFieldItem: Record<string, unknown> = { ...workingItem }
  for (const key of Object.keys(workingItem)) {
    if (systemFields.has(key)) continue
    if (accessDeniedKeys.has(key)) {
      delete computedFieldItem[key]
      continue
    }
    if (key in filtered) continue
    if (additions.keys.has(key) || declaredNames.has(key)) continue
    delete computedFieldItem[key]
  }

  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    if (fieldName in filtered) {
      continue
    }

    if (!fieldConfig.virtual) {
      continue
    }

    // Projection-aware skip (ADR-0027): same rule as the stored-field pass
    // above — a fragment that does not select this virtual field does no
    // work for it at all.
    if (selection?.fields && !selection.fields.has(fieldName)) {
      continue
    }

    // A virtual field with no resolveOutput hook can never produce a value
    // on ANY read — there is nothing to compute, so there is nothing to do,
    // including evaluating its read access (ADR-0027 reconciles the
    // access-only evaluation this branch used to preserve: a field that
    // never has output has no side effect worth preserving access for).
    if (!(fieldConfig.hooks?.resolveOutput && listKey)) {
      continue
    }

    const result = await resolveReadableFieldValue({
      fieldConfig,
      fieldName,
      value: undefined, // Virtual fields don't have a database value
      accessItem: workingItem,
      hookItem: computedFieldItem,
      listKey,
      args,
      config,
    })

    if (result.readable) {
      filtered[fieldName] = result.value
    }
  }

  // Strip relations that were fetched ONLY to satisfy a `needs` declaration
  // (ADR-0025), now that every resolveOutput hook at this level has had the
  // chance to see them (via `computedFieldItem`, never `filtered` itself — a
  // declared dependency is read from stored columns, not from another
  // field's resolved output). A declared dependency is private plumbing, not
  // an implicit `include`: it never widens what the caller receives.
  for (const key of additions.keys) {
    delete filtered[key]
  }

  return filtered as Partial<T>
}
