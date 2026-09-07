import type { OpenSaasConfig, ListConfig } from '../config/types.js'
import { resolveSyntheticReverseRelation } from '../access/engine.js'

/**
 * The nested-write spellings a payload no longer carries. Each was a second
 * write against another list hidden inside one call — N hook chains staged
 * against one atomic decision — and Prisma 8 has no construct to lower six of
 * them onto (ADR-0050). A caller writing several rows authors them inside
 * `context.transaction`.
 */
const REFUSED_KINDS = [
  'create',
  'update',
  'delete',
  'connectOrCreate',
  'set',
  'updateMany',
  'deleteMany',
] as const

/**
 * The two spellings ADR-0050 keeps — an edge is a foreign-key assignment on the
 * row being written, and clearing one is `null` on the same field — which the
 * engine has no lowering for yet. #1153 owns that lowering and removes this
 * refusal with it. Until then the payload reaches the driver as a column value
 * and fails as a raw type error naming neither the list nor the field.
 */
const UNLOWERED_KINDS = ['connect', 'disconnect'] as const

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
        `${kinds.map((kind) => `\`${kind}\``).join(', ')} operation, which the write payload no ` +
        `longer accepts. A payload holds this list's own scalars; write the related rows ` +
        `yourself and wrap them in \`context.transaction\` when they must land together.`,
    )
    this.name = 'NestedRelationInputError'
  }
}

/**
 * Thrown when a write payload spells `connect`/`disconnect` on a relation. The
 * spelling is the one ADR-0050 keeps, so this is a temporary refusal rather
 * than a contract: it stands only until #1153 lowers relation input onto the
 * rc.8 collection, and goes away there.
 */
export class RelationInputNotLoweredError extends Error {
  constructor(
    readonly listName: string,
    readonly fieldKey: string,
    readonly kinds: readonly string[],
  ) {
    super(
      `Cannot write "${listName}" — "${fieldKey}" carries a ` +
        `${kinds.map((kind) => `\`${kind}\``).join(', ')} operation, which this engine does not ` +
        `lower onto the database yet. Relation input arrives in #1153; until then a payload ` +
        `carries this list's own columns, a to-one relation's foreign key among them.`,
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
 * input, on a relation key — naming the field and every refused kind on it at
 * once.
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
  }
}
