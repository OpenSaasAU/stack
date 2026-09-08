import type { OpenSaasConfig, ListConfig, RelationshipField } from '../config/types.js'
import type { AccessContext, OrmClient } from '../access/types.js'
import { checkAccess } from '../access/index.js'
import { resolveSyntheticReverseRelation } from '../access/engine.js'
import { shouldHaveForeignKey } from '../fields/index.js'
import {
  firstMatching,
  identityPredicate,
  writeCollection,
  type WhereCombinators,
} from '../secured/write.js'
import { resolveWhere, type WherePlan } from '../secured/vocabulary.js'

/**
 * The spellings ADR-0050 removes from a write payload. The nested writes among
 * them have no replacement in the payload at all: each was a second write
 * against another list hidden inside one call — N hook chains staged against
 * one atomic decision — so a caller writing several rows authors them inside
 * `context.transaction`. `disconnect` is removed with a named replacement
 * instead: assigning `null` to the same relationship field.
 */
const REFUSED_KINDS = [
  'create',
  'update',
  'delete',
  'connectOrCreate',
  'disconnect',
  'set',
  'updateMany',
  'deleteMany',
] as const

/**
 * Thrown when a write payload spells a nested operation on a relationship
 * field. The generated input types make this a compile error; this is the
 * runtime half, for a payload that reached the engine untyped — a server
 * action's form data, an MCP tool call, a plugin — or one a `resolveInput`
 * hook assembled after the types had their say.
 */
export class NestedRelationInputError extends Error {
  constructor(
    readonly listName: string,
    readonly fieldKey: string,
    readonly kinds: readonly string[],
  ) {
    super(
      `Cannot write "${listName}" — "${fieldKey}" carries a nested ` +
        `${quoteKinds(kinds)} operation, which the write payload no longer accepts. A payload ` +
        `holds this list's own scalars; ${replacementFor(fieldKey, kinds)}.`,
    )
    this.name = 'NestedRelationInputError'
  }
}

/**
 * Thrown when a write payload carries relation input on a relationship field
 * that does not own the foreign key — an inverse field, a to-many, the
 * non-owning half of a one-to-one, or a synthetic back-relation. Linking
 * through one of those sets no column on the row being written: it is N
 * updates against the other list, each owing that list's access and hooks
 * (ADR-0050).
 */
export class NonOwningRelationInputError extends Error {
  constructor(
    readonly listName: string,
    readonly fieldKey: string,
  ) {
    super(
      `Cannot write "${listName}" — "${fieldKey}" does not own a foreign key, so linking ` +
        `through it writes rows of the other list rather than a column on this one. Write those ` +
        `rows against their own list, and wrap them in \`context.transaction\` when they must ` +
        `land together.`,
    )
    this.name = 'NonOwningRelationInputError'
  }
}

/**
 * Thrown when a foreign-key-owning relationship field carries something other
 * than `{ connect: { id } }` or `null` — a `{ connect: cond ? … : undefined }`
 * that resolved to nothing, an empty object, or a bare column value. Left
 * alone the first two reach the driver as `{}`, which it reports against the
 * column type rather than the field.
 */
export class MalformedRelationInputError extends Error {
  constructor(
    readonly listName: string,
    readonly fieldKey: string,
  ) {
    super(
      `Cannot write "${listName}" — "${fieldKey}" carries neither \`{ connect: { id } }\` nor ` +
        `\`null\`. A relationship field takes the row to link to, or \`null\` to clear the edge.`,
    )
    this.name = 'MalformedRelationInputError'
  }
}

/**
 * Thrown when a foreign-key column (`authorId`) carries something other than a
 * row id or `null` — an ORM scalar wrapper such as `{ set: … }`, say. Lowering
 * one would write the edge without the reachability query the column's own
 * spelling owes, so the shape is refused rather than passed to the driver.
 */
export class MalformedForeignKeyInputError extends Error {
  constructor(
    readonly listName: string,
    readonly column: string,
    readonly fieldName: string,
  ) {
    super(
      `Cannot write "${listName}" — "${column}" carries neither the id of a row nor \`null\`. A ` +
        `foreign-key column takes the row to link to, or \`null\` to clear the edge; write ` +
        `"${fieldName}" instead when you want the relationship field's own spelling.`,
    )
    this.name = 'MalformedForeignKeyInputError'
  }
}

/**
 * Thrown when a write payload spells one edge both ways — the relationship
 * field (`author`) and its foreign-key column (`authorId`) in the same call.
 * The generated input type is an intersection of independent optional members,
 * so it admits the pair; only one of the two values can reach the row, and the
 * discarded one would still be checked for reachability and could deny the
 * write over a value the caller never sees applied.
 */
export class ConflictingRelationInputError extends Error {
  constructor(
    readonly listName: string,
    readonly fieldKey: string,
    readonly column: string,
  ) {
    super(
      `Cannot write "${listName}" — "${fieldKey}" and "${column}" are two spellings of one edge ` +
        `and this payload carries both. Write one of them: "${fieldKey}" takes ` +
        `\`{ connect: { id } }\` or \`null\`, "${column}" takes the id of a row or \`null\`.`,
    )
    this.name = 'ConflictingRelationInputError'
  }
}

/**
 * Thrown when a `connect` names a list the config does not declare — the ref
 * and the config have drifted, which is a generation or wiring fault rather
 * than an access denial, so it is reported rather than folded into the silent
 * `null`.
 */
export class RelationTargetMissingError extends Error {
  constructor(
    readonly listName: string,
    readonly fieldKey: string,
    readonly target: string,
  ) {
    super(
      `Cannot write "${listName}" — "${fieldKey}" refs list "${target}", which the config does ` +
        `not declare. Re-run \`opensaas generate\` so the emitted contract matches the config.`,
    )
    this.name = 'RelationTargetMissingError'
  }
}

function quoteKinds(kinds: readonly string[]): string {
  return kinds.map((kind) => `\`${kind}\``).join(', ')
}

function replacementFor(fieldKey: string, kinds: readonly string[]): string {
  const parts: string[] = []
  if (kinds.some((kind) => kind !== 'disconnect')) {
    parts.push(
      'write the related rows yourself and wrap them in `context.transaction` when they must ' +
        'land together',
    )
  }
  if (kinds.includes('disconnect')) {
    parts.push(`clear an edge by assigning \`null\` to "${fieldKey}"`)
  }
  return parts.join('; ')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRowId(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number'
}

/**
 * The id a foreign-key column names, `null` for a cleared edge, or `undefined`
 * for a key the payload did not carry. Anything else is refused: the shape
 * check the refusal pass and the lowering pass both read the column through,
 * so a payload cannot be shaped one way for one and another way for the other.
 */
function foreignKeyIdOf(
  listName: string,
  key: { column: string; field: string },
  value: unknown,
): string | number | null | undefined {
  if (value === undefined || value === null || isRowId(value)) return value
  throw new MalformedForeignKeyInputError(listName, key.column, key.field)
}

/**
 * What a payload key names on this list. `owning` carries the foreign-key
 * column a `connect` or a `null` lowers onto, and the list that column
 * references; `foreignKey` is that same column named directly, which is the
 * other spelling of the same edge and owes the same two access components
 * (ADR-0050); `inverse` is a relationship the other side keys, including a
 * synthetic `from_<List>_<field>` back-relation, which a list-only `ref`
 * elsewhere in the config creates undeclared on its target and which reaches a
 * sudo payload through `filterWritableFields`.
 *
 * The `owning`/`inverse` split is the whole arity rule of ADR-0050: an edge is
 * a foreign-key assignment on the row being written, and only one end of a
 * relationship holds that column.
 */
type PayloadKey =
  | { kind: 'column' }
  | { kind: 'owning'; column: string; target: string; field: string }
  | { kind: 'foreignKey'; column: string; target: string; field: string }
  | { kind: 'inverse' }

/**
 * The relationship field that owns `fieldKey` as its foreign-key column, when
 * `fieldKey` is one. The contract names that column `<field>Id`
 * (`contract/derive.ts`), so the owner is read back off the same convention
 * the column was emitted under. A list cannot declare a field of its own by
 * that name — `claimMember` in `contract/derive.ts` refuses the collision — so
 * the two readings of one key never have to be ranked.
 */
function foreignKeyColumn(
  fieldKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listName: string,
  config: OpenSaasConfig,
): PayloadKey | null {
  if (!fieldKey.endsWith('Id') || fieldKey.length <= 2) return null
  const owner = fieldKey.slice(0, -2)
  const field = listConfig.fields[owner]
  if (field?.type !== 'relationship') return null

  const relation = field as RelationshipField
  if (!shouldHaveForeignKey(listName, owner, relation, config)) return null
  return {
    kind: 'foreignKey',
    column: fieldKey,
    target: relation.ref.split('.')[0],
    field: owner,
  }
}

function classifyKey(
  fieldKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listName: string,
  config: OpenSaasConfig,
): PayloadKey {
  const field = listConfig.fields[fieldKey]
  if (field?.type !== 'relationship') {
    if (field === undefined) {
      const column = foreignKeyColumn(fieldKey, listConfig, listName, config)
      if (column !== null) return column
    }
    return resolveSyntheticReverseRelation(fieldKey, listName, config) === null
      ? { kind: 'column' }
      : { kind: 'inverse' }
  }

  const relation = field as RelationshipField
  if (!shouldHaveForeignKey(listName, fieldKey, relation, config)) return { kind: 'inverse' }
  return {
    kind: 'owning',
    column: `${fieldKey}Id`,
    target: relation.ref.split('.')[0],
    field: fieldKey,
  }
}

function kindsIn(value: unknown, candidates: readonly string[]): string[] {
  const entries = Array.isArray(value) ? value : [value]
  const found = new Set<string>()
  for (const entry of entries) {
    if (!isPlainObject(entry)) continue
    for (const kind of candidates) {
      // Presence is the value being there, not the key: an explicitly-undefined
      // key (`{ create: cond ? x : undefined }`) requested no nested write.
      if (entry[kind] !== undefined) found.add(kind)
    }
  }
  return [...found]
}

/**
 * The row a `connect` names, or `undefined` when the value is not one. Only
 * `{ connect: { id } }` qualifies: a second key beside `connect`, or beside
 * `id`, is a spelling the engine does not lower and is refused rather than
 * silently narrowed to the part it recognises.
 */
function connectId(value: unknown): string | number | undefined {
  if (!isPlainObject(value)) return undefined
  const keys = Object.keys(value).filter((key) => value[key] !== undefined)
  if (keys.length !== 1 || keys[0] !== 'connect') return undefined
  const criterion = value.connect
  if (!isPlainObject(criterion)) return undefined
  const criterionKeys = Object.keys(criterion).filter((key) => criterion[key] !== undefined)
  if (criterionKeys.length !== 1 || criterionKeys[0] !== 'id') return undefined
  const id = criterion.id
  return typeof id === 'string' || typeof id === 'number' ? id : undefined
}

/**
 * Refuse a payload carrying both spellings of one edge. Checked over the whole
 * payload before any per-key refusal, so the answer does not turn on which of
 * the two keys the caller happened to write first.
 */
function refuseDoubleSpelledEdge(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  config: OpenSaasConfig,
  data: Record<string, unknown>,
): void {
  for (const [fieldKey, value] of Object.entries(data)) {
    if (value === undefined) continue
    const key = classifyKey(fieldKey, listConfig, listName, config)
    if (key.kind !== 'foreignKey') continue
    if (data[key.field] !== undefined) {
      throw new ConflictingRelationInputError(listName, key.field, key.column)
    }
  }
}

/**
 * Refuse a payload that spells one edge twice, a nested write, relation input
 * on a field that owns no foreign key, anything but `{ connect: { id } }` /
 * `null` on one that does, or anything but a row id / `null` on a foreign-key
 * column — naming the field, and every refused kind spelled on it at once.
 *
 * Runs after the operation-access gate, so a caller with no access to the list
 * gets the silent denial and never learns from the error which fields it
 * declares (ADR-0031). It runs a second time over the resolved data, so a
 * `resolveInput` hook that assembles a relation payload is refused the same way
 * a caller's own is.
 */
export function refuseNestedRelationInput(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  config: OpenSaasConfig,
  data: Record<string, unknown> | undefined,
): void {
  if (data === undefined) return
  refuseDoubleSpelledEdge(listName, listConfig, config, data)

  for (const [fieldKey, value] of Object.entries(data)) {
    const key = classifyKey(fieldKey, listConfig, listName, config)
    if (key.kind === 'column') continue

    // A foreign-key column holds an id rather than relation input, so only its
    // own shape is settled here — the reachability query it owes is spent
    // where the edge is lowered.
    if (key.kind === 'foreignKey') {
      foreignKeyIdOf(listName, key, value)
      continue
    }

    const nested = kindsIn(value, REFUSED_KINDS)
    if (nested.length > 0) throw new NestedRelationInputError(listName, fieldKey, nested)

    if (value === undefined) continue
    if (key.kind === 'inverse') throw new NonOwningRelationInputError(listName, fieldKey)
    if (value === null) continue
    if (connectId(value) === undefined) throw new MalformedRelationInputError(listName, fieldKey)
  }
}

/**
 * The outcome of lowering a payload's relation input onto columns.
 * `unreachable` is the target the caller cannot see and the target that is not
 * there, reported as one: telling them apart is the probing oracle ADR-0050
 * spent the reachability query to close.
 */
export type RelationLowering =
  { status: 'linked'; data: Record<string, unknown> } | { status: 'unreachable' }

/**
 * Whether `id` names a row of `target` this caller may see: the target list's
 * `query` access ANDed with the identity criterion, evaluated in the database
 * so a rule returning a filter is applied by the same seam a read applies it
 * through. A non-existent id folds into the same answer.
 */
async function reachable(
  listName: string,
  fieldKey: string,
  target: string,
  id: string | number,
  args: LowerRelationInputArgs,
): Promise<boolean> {
  const { config, context, ormHandle, ops } = args
  const targetConfig = config.lists[target]
  if (!targetConfig) throw new RelationTargetMissingError(listName, fieldKey, target)

  const scope: WherePlan[] = [identityPredicate(target, id)]
  if (context._isSudo !== true) {
    const access = await checkAccess(targetConfig.access?.operation?.query, {
      session: context.session,
      context,
    })
    if (access === false) return false
    if (access !== true) {
      scope.push(
        await resolveWhere(access, {
          listName: target,
          listConfig: targetConfig,
          config,
          session: context.session,
          context,
          checkFieldRead: false,
          applyRelationAccess: true,
          accessFilterPath: [target],
        }),
      )
    }
  }

  const row = await firstMatching(writeCollection(ormHandle, target), scope, ops)
  return row !== null
}

export interface LowerRelationInputArgs {
  listName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  config: OpenSaasConfig
  context: AccessContext
  /** The transaction handle the write itself runs on, so both statements share it. */
  ormHandle: OrmClient
  ops: WhereCombinators
  data: Record<string, unknown>
}

/**
 * Lower a payload's relation input onto the columns the row actually carries:
 * `{ connect: { id } }` becomes the foreign key after the reachability query
 * says the caller may see that row, and `null` becomes the same column cleared
 * (ADR-0050). Both statements are issued by the terminal, inside its origin.
 *
 * A foreign-key column named directly (`authorId`) is the same edge spelled
 * without the relationship field, so it takes the same reachability query here
 * rather than a second copy of one: an unreadable target and an absent one are
 * one answer for both spellings, which is what stops the column being a
 * probing oracle (#1331).
 *
 * Runs after the field-level write gate, so an edge on a field the caller may
 * not write has already thrown — the reachability query never fires for a link
 * the caller could not make anyway.
 */
export async function lowerRelationInput(args: LowerRelationInputArgs): Promise<RelationLowering> {
  const { listName, listConfig, config, data } = args
  let lowered: Record<string, unknown> | undefined

  for (const [fieldKey, value] of Object.entries(data)) {
    const key = classifyKey(fieldKey, listConfig, listName, config)
    if (key.kind === 'column') continue
    if (key.kind === 'inverse') {
      if (value === undefined) continue
      throw new NonOwningRelationInputError(listName, fieldKey)
    }

    if (key.kind === 'foreignKey') {
      const id = foreignKeyIdOf(listName, key, value)
      if (id === undefined || id === null) continue
      if (!(await reachable(listName, key.field, key.target, id, args))) {
        return { status: 'unreachable' }
      }
      continue
    }

    lowered ??= { ...data }
    delete lowered[fieldKey]
    if (value === undefined) continue
    if (value === null) {
      lowered[key.column] = null
      continue
    }

    const id = connectId(value)
    if (id === undefined) throw new MalformedRelationInputError(listName, fieldKey)
    if (!(await reachable(listName, fieldKey, key.target, id, args))) {
      return { status: 'unreachable' }
    }
    lowered[key.column] = id
  }

  return { status: 'linked', data: lowered ?? data }
}
