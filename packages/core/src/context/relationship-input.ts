import type { OpenSaasConfig, ListConfig } from '../config/types.js'
import { resolveSyntheticReverseRelation } from '../access/engine.js'

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
 * The one relationship spelling ADR-0050 keeps — an edge is a foreign-key
 * assignment on the row being written — which the engine has no lowering for
 * yet. #1153 owns that lowering and removes this refusal with it.
 */
const UNLOWERED_KINDS = ['connect'] as const

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

/**
 * Thrown when a write payload carries relation input on a relationship key —
 * `connect`, or any other object where a column value belongs. The spelling
 * ADR-0050 keeps is `connect`, so this is a temporary refusal rather than a
 * contract: it stands only until #1153 lowers relation input onto the rc.8
 * collection, and goes away there.
 *
 * `kinds` is empty when the object names no recognised spelling — a
 * `{ connect: cond ? … : undefined }` that resolved to nothing, say. The
 * payload is still refused, because a relationship key carries a foreign key or
 * `null`, never an object.
 */
export class RelationInputNotLoweredError extends Error {
  constructor(
    readonly listName: string,
    readonly fieldKey: string,
    readonly kinds: readonly string[],
  ) {
    super(
      `Cannot write "${listName}" — "${fieldKey}" carries ` +
        `${kinds.length > 0 ? `a ${quoteKinds(kinds)} operation` : 'relation input as an object'}` +
        `, which this engine does not lower onto the database yet. Relation input arrives in ` +
        `#1153; until then a payload carries this list's own columns, a to-one relation's ` +
        `foreign key among them.`,
    )
    this.name = 'RelationInputNotLoweredError'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A key is relation-shaped when the list declares it as a relationship, or when
 * a list-only `ref` elsewhere in the config synthesizes it as a back-relation
 * (`from_<List>_<field>`). The synthetic ones are undeclared by design and
 * reach a sudo payload through `filterWritableFields`, so the refusal has to
 * recognise them or they go on to the driver.
 */
function isRelationKey(
  fieldKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listName: string,
  config: OpenSaasConfig,
): boolean {
  if (listConfig.fields[fieldKey]?.type === 'relationship') return true
  return resolveSyntheticReverseRelation(fieldKey, listName, config) !== null
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
 * Refuse a payload that spells a nested write, or a not-yet-lowered relation
 * input, on a relation key — naming the field, and every refused kind spelled
 * on it at once.
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
  for (const [fieldKey, value] of Object.entries(data)) {
    if (!isRelationKey(fieldKey, listConfig, listName, config)) continue

    const nested = kindsIn(value, REFUSED_KINDS)
    if (nested.length > 0) throw new NestedRelationInputError(listName, fieldKey, nested)

    const unlowered = kindsIn(value, UNLOWERED_KINDS)
    if (unlowered.length > 0) throw new RelationInputNotLoweredError(listName, fieldKey, unlowered)

    if (isPlainObject(value) || Array.isArray(value)) {
      throw new RelationInputNotLoweredError(listName, fieldKey, [])
    }
  }
}
