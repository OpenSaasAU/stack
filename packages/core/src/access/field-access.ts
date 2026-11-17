import type { Session, AccessContext, AccessControl } from './types.js'
import type { FieldAccess, FieldAccessControl } from './types.js'
import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
// `ValidationError` is referenced only inside function bodies (call-time), never
// at module-evaluation time, so the field-access ⇄ hooks import cycle is safe
// under ESM live bindings.
import { ValidationError } from '../hooks/index.js'
import { InvalidFieldAccessResultError } from './errors.js'
import { checkAccess } from './engine.js'
import { guardedRuleItem, NO_RULE_VIEWS, ruleRowOf, type RuleRow } from './rule-item.js'
import {
  resolveListMembers,
  unhandledMember,
  type DeclaredFieldMember,
  type ListMembers,
} from '../members/list-members.js'

function isHookOnlyAccess(fieldAccess: FieldAccess | undefined): boolean {
  return fieldAccess?.write === 'hooks'
}

/** Whether `field` is declared Hook-only (`access: { write: 'hooks' }`, ADR-0076). */
export function isHookOnlyField(field: FieldConfig): boolean {
  return isHookOnlyAccess(field.access)
}

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
 * answered here. The touch is recorded as well as thrown, because a rule can
 * catch what it threw.
 */
function createPoisonedItem(): {
  readonly item: Record<string, unknown>
  readonly touched: () => boolean
} {
  let touched = false
  const poison = (prop: string | symbol): never => {
    touched = true
    throw new PredicateTimeItemAccessError(String(prop))
  }
  const item = new Proxy(
    {},
    {
      get: (_target, prop) => poison(prop),
      has: (_target, prop) => poison(prop),
      ownKeys: () => poison('ownKeys'),
      getOwnPropertyDescriptor: (_target, prop) => poison(prop),
    },
  ) as Record<string, unknown>
  return { item, touched: () => touched }
}

/**
 * What a rule answers when it has no row to ask about. A rule that touched the
 * poison is row-dependent whatever it then returned or threw. A non-boolean
 * answer is a distinct, louder failure (ADR-0030) and propagates.
 */
async function answerWithoutRow(
  ask: (poisoned: Record<string, unknown>) => Promise<boolean>,
): Promise<'allow' | 'deny' | 'row-dependent'> {
  const { item, touched } = createPoisonedItem()
  try {
    const answer = await ask(item)
    if (touched()) return 'row-dependent'
    return answer ? 'allow' : 'deny'
  } catch (err) {
    if (touched() && !(err instanceof InvalidFieldAccessResultError)) return 'row-dependent'
    throw err
  }
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
    /** A write's row, so the rule runs on a guarded `item` (ADR-0082). */
    ruleRow?: RuleRow
  },
): Promise<boolean> {
  if (operation !== 'read' && isHookOnlyAccess(fieldAccess)) {
    return false
  }

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

  const guard =
    operation !== 'read' && args.ruleRow && args.item ? guardedRuleItem(args.ruleRow) : undefined
  let result: Awaited<ReturnType<typeof accessControl>>
  try {
    result = await accessControl({
      session: args.session,
      item: guard?.item ?? args.item,
      context: args.context,
      inputData: args.inputData,
      operation,
    } as Parameters<typeof accessControl>[0])
  } catch (err) {
    if (err instanceof TypeError && guard?.tripped()) return false
    throw err
  }
  if (guard?.tripped()) return false

  if (result === false || result === null || result === undefined) {
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
 * A field's `read` rule answered for a fetched row. A rule that reaches for a
 * relation the row does not carry, or writes through the row, denies whatever
 * it returned, so `item.logs.length` on a withheld relation is a denial rather
 * than a `TypeError`. Only a `TypeError` is taken for that: it is what
 * dereferencing the `undefined` it was handed raises. A `DataCloneError` from
 * cloning a guarded value denies too, and anything else the rule threw is its
 * own failure and propagates (ADR-0082).
 *
 * Synchronous where there is nothing to evaluate, because this runs for every
 * field on every row.
 */
export function checkRowRead(
  fieldAccess: FieldAccess | undefined,
  args: {
    session: Session | null
    context: AccessContext & { _isSudo?: boolean }
  },
  row: RuleRow,
): boolean | Promise<boolean> {
  if (args.context._isSudo || !fieldAccess?.read) return true
  return evaluateRowRead(fieldAccess, args, row)
}

function isDataCloneError(err: unknown): boolean {
  return err instanceof Error && err.name === 'DataCloneError'
}

async function evaluateRowRead(
  fieldAccess: FieldAccess,
  args: {
    session: Session | null
    context: AccessContext & { _isSudo?: boolean }
  },
  row: RuleRow,
): Promise<boolean> {
  const { item, tripped } = guardedRuleItem(row)
  try {
    const readable = await checkFieldAccess(fieldAccess, 'read', { ...args, item })
    return readable && !tripped()
  } catch (err) {
    if (err instanceof TypeError && tripped()) return false
    if (isDataCloneError(err)) return false
    throw err
  }
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
 * the pre-query counterpart, called from `secured/vocabulary.ts`'s `where`/
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
  return (await classifyRowIndependentRead(fieldAccess, args)) === 'allow'
}

/**
 * What a field's `read` rule answers when it is asked with no row: `'allow'`
 * or `'deny'` for a rule that never touched `item`, and `'row-dependent'` for
 * one that did and therefore cannot be answered until a row exists.
 *
 * This is the one interpretation of that question (ADR-0044's "one
 * classifier"), and its consumers differ deliberately in what they do with
 * the answer. `isFieldReadableForPredicate` folds `'row-dependent'` into a
 * denial, because a predicate that cannot be answered must refuse (ADR-0031).
 * The include path keeps the three apart: `'deny'` omits the relation before
 * the query, and `'row-dependent'` fetches it and leaves Field Visibility to
 * decide (ADR-0044). Neither is to be harmonised into the other.
 *
 * A rule that returns a non-boolean is a distinct, louder failure (#913,
 * ADR-0030) — `InvalidFieldAccessResultError` — and propagates rather than
 * being folded into `'deny'`.
 */
export async function classifyRowIndependentRead(
  fieldAccess: FieldAccess | undefined,
  args: {
    session: Session | null
    context: AccessContext & { _isSudo?: boolean }
  },
): Promise<'allow' | 'deny' | 'row-dependent'> {
  return await answerWithoutRow((item) =>
    checkFieldAccess(fieldAccess, 'read', {
      session: args.session,
      context: args.context,
      item,
    }),
  )
}

/**
 * The write-side counterpart of {@link classifyRowIndependentRead}: what a
 * field's `create`/`update` rule answers when it is asked with neither a row
 * nor a payload.
 *
 * Both `item` and `inputData` are poisoned, because either one makes the rule
 * unanswerable ahead of a request — a rule reading the payload is as
 * row-dependent, for this purpose, as one reading the row.
 *
 * A rule that returns a non-boolean raises `InvalidFieldAccessResultError`
 * (ADR-0030), which propagates rather than being folded into `'deny'`.
 */
export async function classifyRowIndependentWrite(
  fieldAccess: FieldAccess | undefined,
  operation: 'create' | 'update',
  args: {
    session: Session | null
    context: AccessContext & { _isSudo?: boolean }
  },
): Promise<'allow' | 'deny' | 'row-dependent'> {
  return await answerWithoutRow((poisoned) =>
    checkFieldAccess(fieldAccess, operation, {
      session: args.session,
      context: args.context,
      item: poisoned,
      inputData: poisoned,
    }),
  )
}

/**
 * The operation-level counterpart of {@link classifyRowIndependentWrite}: what
 * a list's `create` operation rule (`access.operation.create`) answers when
 * asked with no row to test — the question `tools/list` needs before
 * advertising a `create` tool at all (#1355). A rule that never reaches into
 * `item` (the common case — create has no existing row to depend on) is
 * answered directly; one that does (most plausibly a rule shared with
 * `update`/`delete`) cannot be classified ahead of a real request and is left
 * `'row-dependent'` — the actual `create` call still enforces it.
 *
 * This does not call {@link checkCreateAccess} — that function's args carry no
 * `item` to poison, since production create access is always evaluated
 * without one. It instead calls {@link checkAccess} directly and applies the
 * same boolean-only contract `checkCreateAccess` enforces (ADR-0030): a
 * result that is neither `true` nor `false` (a filter, say) is a rule that
 * would throw `InvalidCreateAccessResultError` at actual create time
 * regardless of session, so it is classified as a denial rather than
 * advertised.
 */
export async function classifyRowIndependentCreateAccess(
  accessControl: AccessControl | undefined,
  args: {
    session: Session | null
    context: AccessContext
  },
): Promise<'allow' | 'deny' | 'row-dependent'> {
  return await answerWithoutRow(
    async (item) =>
      (await checkAccess(accessControl, {
        session: args.session,
        context: args.context,
        item,
      })) === true,
  )
}

/**
 * What a field's `create`/`update` rule answers for one known row, with no
 * payload: `'allow'` or `'deny'` as the write would decide it for that row,
 * and `'row-dependent'` for a rule that reads `inputData` and so still cannot
 * be answered ahead of a request. The rule sees `row` behind the write's own
 * guard (ADR-0082).
 */
export async function classifyWriteForRow(
  fieldAccess: FieldAccess | undefined,
  operation: 'create' | 'update',
  args: {
    session: Session | null
    context: AccessContext & { _isSudo?: boolean }
  },
  row: RuleRow,
): Promise<'allow' | 'deny' | 'row-dependent'> {
  return await answerWithoutRow((poisoned) =>
    checkFieldAccess(fieldAccess, operation, {
      session: args.session,
      context: args.context,
      item: row.item,
      ruleRow: row,
      inputData: poisoned,
    }),
  )
}

export function writeRuleRow(
  item: Record<string, unknown> | undefined,
  fieldConfigs: Record<string, FieldConfig>,
  config: OpenSaasConfig | undefined,
  listKey: string | undefined,
): RuleRow | undefined {
  return item ? ruleRowOf(item, NO_RULE_VIEWS, fieldConfigs, config, listKey) : undefined
}

type WriteOwners = {
  foreignKeyOwners: ReadonlyMap<string, string>
  splitColumnOwners: ReadonlyMap<string, string>
}

const writeOwnersByList = new WeakMap<ListMembers, WriteOwners>()

function writeOwnersOf(members: ListMembers): WriteOwners {
  const known = writeOwnersByList.get(members)
  if (known !== undefined) return known
  const built = buildWriteOwners(members)
  writeOwnersByList.set(members, built)
  return built
}

function buildWriteOwners(members: ListMembers): WriteOwners {
  const foreignKeyOwners = new Map<string, string>()
  const splitColumnOwners = new Map<string, string>()
  for (const member of members.members.values()) {
    switch (member.kind) {
      case 'field':
        if (member.storage.kind === 'columns') {
          // A part named like its field resolves as the field, not as a partColumn.
          for (const part of member.storage.parts) {
            if (part.name === member.name) splitColumnOwners.set(part.name, member.name)
          }
        }
        break
      case 'foreignKey':
        foreignKeyOwners.set(member.name, member.field)
        break
      case 'partColumn':
        splitColumnOwners.set(member.name, member.field)
        break
      case 'syntheticBackRelation':
      case 'systemField':
        break
      default:
        return unhandledMember(member)
    }
  }
  return { foreignKeyOwners, splitColumnOwners }
}

export async function filterWritableFields<T extends Record<string, unknown>>(
  data: T,
  operation: 'create' | 'update',
  args: {
    session: Session | null
    item?: Record<string, unknown>
    context: AccessContext & { _isSudo?: boolean }
    inputData?: Record<string, unknown>
    /** The list being written. */
    listName: string
    /** The full config, which says what each name on the list is. */
    config: OpenSaasConfig
    /**
     * Field keys `applyCreateDefaults` filled on this write (`create` only) —
     * see the check below and `applyCreateDefaults`'s own doc comment.
     */
    defaultedFields?: ReadonlySet<string>
  },
): Promise<Partial<T>> {
  const filtered: Record<string, unknown> = {}
  const members = resolveListMembers(args.config, args.listName)
  const declaredField = (name: string): DeclaredFieldMember | undefined => {
    const member = members.members.get(name)
    return member?.kind === 'field' ? member : undefined
  }
  const checkArgs = {
    ...args,
    ruleRow: writeRuleRow(
      args.item,
      args.config.lists[args.listName].fields,
      args.config,
      args.listName,
    ),
  }

  // A directly-written foreign-key column is the same edge `connect` lowers to
  // (ADR-0050), gated by the owning relationship's write access (#1326); the
  // reachability half is `lowerRelationInput`'s (#1331). A part column is
  // produced by `splitColumns` after validation (#789), so a caller naming one
  // is refused below.
  const { foreignKeyOwners, splitColumnOwners } = writeOwnersOf(members)

  for (const key of Object.keys(args.inputData ?? {})) {
    const owner = splitColumnOwners.get(key)
    if (owner !== undefined && owner !== key) {
      throw new ValidationError([
        `Cannot ${operation} "${key}": it is a storage column of "${owner}". ` +
          `Write "${owner}" instead; use context.unsafe to write columns directly.`,
      ])
    }
  }

  const owningField = (key: string): string =>
    foreignKeyOwners.get(key) ?? splitColumnOwners.get(key) ?? key
  const callerFields = new Set(Object.keys(args.inputData ?? {}).map(owningField))

  const suppliedFields = new Set(
    Object.entries(args.inputData ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([key]) => owningField(key)),
  )

  for (const fieldName of callerFields) {
    const declared = declaredField(fieldName)
    if (Object.hasOwn(data, fieldName) || declared === undefined) continue
    if (!suppliedFields.has(fieldName)) continue
    if (declared.storage.kind === 'computed') continue
    const keyed = [...Object.keys(data)].some((key) => owningField(key) === fieldName)
    if (keyed) continue
    if (!(await checkFieldAccess(declared.field.access, operation, { ...checkArgs }))) {
      throw new ValidationError([`Cannot ${operation} "${fieldName}": field-level access denied.`])
    }
  }

  for (const [fieldName, value] of Object.entries(data)) {
    const declared = declaredField(fieldName)
    const fieldConfig = declared?.field
    const callerSupplied =
      args.inputData === undefined ||
      callerFields.has(owningField(fieldName)) ||
      args.defaultedFields?.has(fieldName) === true

    if (members.members.get(fieldName)?.kind === 'systemField') {
      throw new ValidationError([
        `Cannot ${operation} "${fieldName}": it is system-managed and cannot be written` +
          (fieldName === 'id'
            ? ` through the secured surface. To write explicit ids, use context.unsafe.`
            : `. Remove it from the payload.`),
      ])
    }

    // A value `applyCreateDefaults` filled because EVERYTHING upstream (the
    // caller, every resolveInput hook) left it omitted — not a value anyone
    // wrote — MAY be exempted from the `create` deny, but only when the field
    // opts in via `access.allowCreateDefault` (see its doc comment): a
    // session-dependent `create` rule must still block the whole create for a
    // denied session, defaultValue or not (the `total`-style case below), so
    // this is never inferred from `defaultedFields` membership alone. A key
    // the caller or a hook actually supplied is never in `defaultedFields`,
    // so the deny always applies to it regardless of this flag.
    if (
      operation === 'create' &&
      args.defaultedFields?.has(fieldName) &&
      (fieldConfig?.access?.allowCreateDefault || isHookOnlyAccess(fieldConfig?.access))
    ) {
      filtered[fieldName] = value
      continue
    }

    // A field storing nothing — the `virtual` flag, or a `{ kind: 'computed' }`
    // contract descriptor a third-party field can declare without it
    // (issue #1531) — doesn't store in the database, so it is skipped here;
    // its resolveInput hook still runs as a separate side-effect step.
    if (declared?.storage.kind === 'computed') continue

    // A directly-written foreign-key column (`authorId`) — gated by the OWNING
    // relationship field's write access, same as `connect` (#1326). Denied
    // (non-sudo) throws rather than being silently dropped; allowed (or sudo)
    // passes through unchanged, so the column is not a way around the
    // relationship field's write gate.
    // Caller-supplied part columns were refused above, so a part column here
    // came from a hook or `splitColumns`; the owning field's write access still
    // applies when the caller named that field, since the `keyed` skip above
    // ran no check.
    const columnOwner = foreignKeyOwners.get(fieldName) ?? splitColumnOwners.get(fieldName)
    if (columnOwner !== undefined) {
      const canWrite =
        !callerSupplied ||
        (await checkFieldAccess(declaredField(columnOwner)?.field.access, operation, {
          ...checkArgs,
          inputData: args.inputData,
        }))
      if (!canWrite) {
        throw new ValidationError([
          `Cannot ${operation} "${columnOwner}" (via column "${fieldName}"): ` +
            `field-level access denied.`,
        ])
      }
      filtered[fieldName] = value
      continue
    }

    // #564 — undeclared data keys must fail CLOSED.
    // A key that is not a declared field is not a field the list config
    // exposes. The generated Prisma model has MORE fields than the config
    // declares (e.g. back-relations like `from_Enrolment_student`), so allowing
    // an undeclared key to pass through lets a non-sudo caller reach a column
    // the config never exposed. Mirror Keystone's GraphQL-schema behaviour and
    // reject it.
    if (!fieldConfig) {
      throw new ValidationError([
        `Cannot ${operation} "${fieldName}": it is not a field of this list. ` +
          `Undeclared data keys are rejected, even under sudo.`,
      ])
    }

    // #568 — fields denied by field-level access must THROW, not be silently
    // dropped. Keystone threw a GraphQL access error for the same situation;
    // silently stripping the field lets a write "succeed" while doing less than
    // asked (and skips any hook side effects gated on that field).
    // `checkFieldAccess` returns `true` under sudo except for a hook-only
    // field, which it denies for every caller.
    const canWrite =
      !callerSupplied ||
      (await checkFieldAccess(fieldConfig.access, operation, {
        ...checkArgs,
        inputData: args.inputData,
      }))

    if (!canWrite) {
      throw new ValidationError([`Cannot ${operation} "${fieldName}": field-level access denied.`])
    }

    filtered[fieldName] = value
  }

  return filtered as Partial<T>
}
