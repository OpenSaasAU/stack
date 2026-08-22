import type { Session, AccessContext } from './types.js'
import type { FieldAccess, FieldAccessControl } from './types.js'
import type { OpenSaasConfig } from '../config/types.js'
// `ValidationError` is referenced only inside function bodies (call-time), never
// at module-evaluation time, so the field-access ⇄ hooks import cycle is safe
// under ESM live bindings.
import { ValidationError } from '../hooks/index.js'
import { InvalidFieldAccessResultError } from './errors.js'
import { resolveSyntheticReverseRelation } from './engine.js'

/**
 * Marks a throw caused by touching {@link createPoisonedItem}'s `item`, as
 * opposed to some other error a field rule legitimately raises. Not exported
 * — callers only ever see its effect (a `false` from
 * `isFieldReadableForPredicate`), never the class itself.
 */
class PredicateTimeItemAccessError extends Error {}

/**
 * An `item` that throws {@link PredicateTimeItemAccessError} on ANY attempt to
 * read a property off it — including via optional chaining (`item?.x`),
 * since the Proxy itself is a truthy object and optional chaining still
 * performs the property read once its base is non-nullish. Used by
 * `isFieldReadableForPredicate` to detect a read rule that depends on the
 * fetched row: there is no row yet at predicate-evaluation time (see that
 * function's doc), so any rule that reaches into `item` at all cannot be
 * answered here.
 */
function createPoisonedItem(): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        throw new PredicateTimeItemAccessError(String(prop))
      },
      has(_target, prop) {
        throw new PredicateTimeItemAccessError(String(prop))
      },
      ownKeys() {
        throw new PredicateTimeItemAccessError('ownKeys')
      },
      getOwnPropertyDescriptor(_target, prop) {
        throw new PredicateTimeItemAccessError(String(prop))
      },
    },
  ) as Record<string, unknown>
}

/**
 * Shared field-level access evaluation.
 *
 * This module is the single, canonical home for field-level access checks. Both
 * read-time (Field Visibility, see `field-visibility.ts`) and write-time paths
 * evaluate field access through `checkFieldAccess` — there is intentionally no
 * second, parallel field-access evaluator. See
 * `docs/adr/0001-access-control-is-a-two-phase-read.md` and the access-control
 * glossary in `CONTEXT.md` for the two-phase read model that motivates this.
 */

/**
 * Check field-level access for a specific operation.
 *
 * This is the canonical field-access evaluator. Its signature is deliberate:
 * field access can depend on the `operation`, on the already-fetched `item`
 * (read/update/delete), and on the `inputData` being written (create/update),
 * so all of those are accepted. Do not introduce a parallel evaluator with a
 * narrower signature.
 *
 * Returns a strict boolean, never a filter: a rule that returns anything else
 * throws `InvalidFieldAccessResultError` rather than defaulting to allow (see
 * that error's doc, ADR-0001, and ADR-0030).
 */
export async function checkFieldAccess(
  fieldAccess: FieldAccess | undefined,
  operation: 'read' | 'create' | 'update',
  args: {
    session: Session | null
    item?: Record<string, unknown>
    context: AccessContext & { _isSudo?: boolean }
    inputData?: Record<string, unknown>
  },
): Promise<boolean> {
  if (args.context._isSudo) {
    return true
  }

  if (!fieldAccess) {
    return true
  }

  // `FieldAccess['read']` is narrower than `FieldAccess['create'/'update']` (it
  // only accepts the single `operation: 'read'` call shape, see `types.ts`),
  // so indexing by a not-yet-narrowed `operation` union produces a callable
  // whose effective parameter type collapses to an intersection TypeScript
  // can't satisfy generically here. Widen back to the general
  // `FieldAccessControl` — the same shape this function has always built and
  // passed below — since by construction the args object always matches
  // whichever operation is actually requested.
  const accessControl = fieldAccess[operation] as FieldAccessControl | undefined
  if (!accessControl) {
    return true
  }

  const result = await accessControl({
    session: args.session,
    item: args.item,
    context: args.context,
    inputData: args.inputData,
    operation,
  } as Parameters<typeof accessControl>[0])

  if (result === false) {
    return false
  }

  if (result === true) {
    return true
  }

  // `FieldAccessControl` is typed to return `boolean` only — field access is a
  // per-field visibility decision, not a row filter (ADR-0001, ADR-0030). A
  // well-typed rule can never reach this line; getting here means a caller
  // bypassed the type (most notably by returning a Prisma filter, the shape
  // operation-level `AccessControl` accepts but this does not). Fail loudly
  // and closed — this operation applies identically whether or not `item` is
  // available, so `create` (which has no `item` to evaluate a filter against)
  // needs no separate answer: neither operation ever honours a non-boolean.
  throw new InvalidFieldAccessResultError(operation, result)
}

/**
 * Whether a field's `read` access allows it to be NAMED in a `where`/`orderBy`
 * predicate, evaluated BEFORE the query runs (#915).
 *
 * Field-level `read` access has always been a post-query check (Field
 * Visibility, `field-visibility.ts`): it strips a denied key from a row that
 * has already been fetched. That leaves the predicate itself unconstrained —
 * a caller can still filter or sort by a field whose value they could never
 * read, and recover it (or its relative order) by probing. This function is
 * the pre-query counterpart, called from `query-validation.ts`'s `where`/
 * `orderBy` walk for every key that resolves to a declared field.
 *
 * It delegates to the same evaluator Field Visibility uses (`checkFieldAccess`),
 * per this module's canonical-evaluator rule above. The one difference is the
 * `item` it hands the rule: there is no fetched row
 * yet, so a rule that depends on one (the shape `FieldAccess['read']`
 * documents as the norm, e.g. `item?.ownerId === session?.userId`) cannot be
 * answered here. Rather than skip the check for such a rule — which would
 * reopen exactly the hole this closes for the fields most likely to be
 * sensitive — it is handed a poisoned `item` that throws on any property
 * read, and that throw is caught and resolved to `false`: a row-dependent
 * `read` rule always denies at predicate time, documented and deliberate
 * (see docs/adr/0031). A rule that never touches `item` (checking only
 * `session`, the common case for a field meant to be filterable/sortable at
 * all) evaluates normally and returns its real answer.
 *
 * A rule that returns a non-boolean is a distinct, louder failure (#913,
 * ADR-0030) — `InvalidFieldAccessResultError` — and is deliberately NOT
 * folded into the `false` here; it propagates so the config bug it signals is
 * never mistaken for an ordinary field-level denial.
 */
export async function isFieldReadableForPredicate(
  fieldAccess: FieldAccess | undefined,
  args: {
    session: Session | null
    context: AccessContext & { _isSudo?: boolean }
  },
): Promise<boolean> {
  try {
    return await checkFieldAccess(fieldAccess, 'read', {
      session: args.session,
      context: args.context,
      item: createPoisonedItem(),
    })
  } catch (err) {
    // Only the poisoned-item signal means "row-dependent, deny". Anything
    // else — including `InvalidFieldAccessResultError` and a genuine bug in
    // the rule itself — propagates unchanged rather than being silently
    // folded into an ordinary denial (found in review of #925).
    if (err instanceof PredicateTimeItemAccessError) return false
    throw err
  }
}

export async function filterWritableFields<T extends Record<string, unknown>>(
  data: T,
  fieldConfigs: Record<
    string,
    {
      access?: FieldAccess
      type?: string
      getColumnNames?: (fieldName: string) => string[]
    }
  >,
  operation: 'create' | 'update',
  args: {
    session: Session | null
    item?: Record<string, unknown>
    context: AccessContext & { _isSudo?: boolean }
    inputData?: Record<string, unknown>
    /**
     * The list being written and the full config — used ONLY to recognise a
     * synthetic reverse-relation key (`from_<List>_<field>`, #978) among the
     * undeclared keys sudo would otherwise pass through unchecked. Both
     * production call sites (the write pipeline, nested-operations) supply
     * these; a direct unit test that omits them keeps the pre-#978 sudo
     * behaviour of passing any undeclared key through, since it has no config
     * to resolve a synthetic key against.
     */
    listName?: string
    config?: OpenSaasConfig
  },
): Promise<Partial<T>> {
  const filtered: Record<string, unknown> = {}

  // Foreign keys must not appear in `data` when using Prisma's relation syntax.
  const foreignKeyFields = new Set<string>()
  // Map each raw per-part column name contributed by a multi-column field
  // (e.g. storage image()/file() in Keystone-parity mode) back to its OWNING
  // declared field. These columns are injected into the write payload by the
  // field's `splitColumns`, AFTER validation (#789), and are intentionally NOT
  // declared as their own entries in `fieldConfigs`, so without this map they
  // would trip the #564 undeclared-key reject below.
  //
  // SECURITY (#568): a raw column must NOT be blanket-passed through. The hooks
  // layer (`splitMultiColumnFields`) only gates the owning field when the
  // LOGICAL key (e.g. `media`) is present, because it iterates declared fields,
  // not data keys. A non-sudo caller who supplies the raw columns DIRECTLY
  // (`data: { media_url, media_size }`) never produces that logical key, so that
  // gate never fires. We therefore gate each raw column HERE by its owning
  // field's write access — denied (non-sudo) throws, allowed (or sudo) passes
  // through — so the legitimate multi-column write path is preserved while the
  // direct-raw-column bypass is closed.
  const splitColumnOwners = new Map<string, { fieldName: string; access?: FieldAccess }>()
  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    if (fieldConfig.type === 'relationship') {
      // For non-many relationships, Prisma creates a foreign key field named `${fieldName}Id`
      const relConfig = fieldConfig as { many?: boolean }
      if (!relConfig.many) {
        foreignKeyFields.add(`${fieldName}Id`)
      }
    }
    if (typeof fieldConfig.getColumnNames === 'function') {
      for (const column of fieldConfig.getColumnNames(fieldName)) {
        splitColumnOwners.set(column, { fieldName, access: fieldConfig.access })
      }
    }
  }

  const isSudo = args.context._isSudo === true

  for (const [fieldName, value] of Object.entries(data)) {
    const fieldConfig = fieldConfigs[fieldName]

    if (['id', 'createdAt', 'updatedAt'].includes(fieldName)) {
      continue
    }

    // Virtual fields don't store in the database — skipped here, but their
    // resolveInput hooks still run as a separate side-effect step.
    if (fieldConfig && 'virtual' in fieldConfig && fieldConfig.virtual) {
      continue
    }

    // Prevents conflicts with Prisma's relation syntax (e.g.,
    // `author: { connect: { id } }`).
    if (foreignKeyFields.has(fieldName)) {
      continue
    }

    // Raw per-part columns produced by a multi-column field's `splitColumns`.
    // They are undeclared by design, so they must not trip the #564 reject — but
    // they must NOT be blanket-passed through either: gate each one by its
    // OWNING field's write access (see the SECURITY note where the map is built).
    // This is the real gate for callers who supply the raw columns directly,
    // because the logical-key gate in `splitMultiColumnFields` never fires for
    // them. Denied (non-sudo) throws — same fail-loud behaviour as a denied
    // declared field (#568); allowed (or sudo, via `checkFieldAccess`) passes
    // through, preserving the legitimate multi-column write path.
    const splitColumnOwner = splitColumnOwners.get(fieldName)
    if (splitColumnOwner) {
      const canWrite = await checkFieldAccess(splitColumnOwner.access, operation, {
        ...args,
        inputData: args.inputData,
      })
      if (!canWrite) {
        throw new ValidationError([
          `Cannot ${operation} "${splitColumnOwner.fieldName}" (via column "${fieldName}"): ` +
            `field-level access denied.`,
        ])
      }
      filtered[fieldName] = value
      continue
    }

    // #564 — undeclared data keys must fail CLOSED.
    // A key with no entry in `fieldConfigs` is not a field the list config
    // exposes. The generated Prisma model has MORE fields than the config
    // declares (e.g. back-relations like `from_Enrolment_student`), so allowing
    // an undeclared key to pass through lets a non-sudo caller drive ungated
    // nested writes on undeclared back-relations. Mirror Keystone's
    // GraphQL-schema behaviour and reject it.
    if (!fieldConfig) {
      if (isSudo) {
        // #978 — sudo bypasses ACCESS CONTROL, not the hooks/validation a
        // recognised relation is entitled to. A synthetic reverse-relation key
        // (a list-only ref's back-relation) is handed to the caller unchanged
        // so processNestedOperations can run its target list's full pipeline,
        // exactly as it would for a declared relationship field. Any other
        // undeclared key has no such route to hooks — passing it straight to
        // Prisma is the same silent-bypass shape this issue closed for
        // relations, so it is refused even under sudo. `listName`/`config`
        // are omitted only by direct unit tests of this function, which keep
        // the pre-#978 blanket sudo passthrough since they have no config to
        // resolve a synthetic key against.
        if (args.listName && args.config) {
          const synthetic = resolveSyntheticReverseRelation(fieldName, args.listName, args.config)
          if (!synthetic) {
            throw new ValidationError([
              `Cannot ${operation} "${fieldName}": it is not a field of this list. ` +
                `Undeclared data keys are rejected, even under sudo.`,
            ])
          }
        }
        filtered[fieldName] = value
        continue
      }
      throw new ValidationError([
        `Cannot ${operation} "${fieldName}": it is not a field of this list. ` +
          `Undeclared data keys are rejected (use sudo to bypass).`,
      ])
    }

    // #568 — fields denied by field-level access must THROW, not be silently
    // dropped. Keystone threw a GraphQL access error for the same situation;
    // silently stripping the field lets a write "succeed" while doing less than
    // asked (and skips any hook side effects gated on that field).
    // `checkFieldAccess` already returns `true` under sudo, so sudo writes never
    // reach the throw below — no parallel sudo path is needed here.
    const canWrite = await checkFieldAccess(fieldConfig.access, operation, {
      ...args,
      inputData: args.inputData,
    })

    if (!canWrite) {
      throw new ValidationError([`Cannot ${operation} "${fieldName}": field-level access denied.`])
    }

    filtered[fieldName] = value
  }

  return filtered as Partial<T>
}
