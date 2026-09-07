import type { FieldConfig, ListConfig } from '../config/types.js'

/**
 * The nested-write spellings a payload no longer carries. Each was a second
 * write against another list hidden inside one call — N hook chains staged
 * against one atomic decision — and Prisma 8 has no construct to lower six of
 * them onto (ADR-0050). A caller writing several rows authors them inside
 * `context.transaction`.
 *
 * `connect` and `disconnect` are deliberately absent: `connect` is engine-owned
 * sugar for a foreign-key assignment on the row being written, and clearing an
 * edge is `null` on the same field.
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
 * Thrown when a write payload spells a nested operation on a relationship
 * field. The generated input types make this a compile error; this is the
 * runtime half, for a payload that reached the engine untyped — a server
 * action's form data, an MCP tool call, a plugin.
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

function isRelationship(fieldConfig: FieldConfig | undefined): boolean {
  return fieldConfig?.type === 'relationship'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function refusedKindsIn(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : [value]
  const found = new Set<string>()
  for (const entry of entries) {
    if (!isPlainObject(entry)) continue
    for (const kind of REFUSED_KINDS) {
      if (kind in entry) found.add(kind)
    }
  }
  return [...found]
}

/**
 * Refuse a payload that spells a nested write on a relationship field, naming
 * the field and every refused kind on it at once.
 *
 * Runs after the operation-access gate, so a caller with no access to the list
 * gets the silent denial and never learns from the error which fields it
 * declares (ADR-0031).
 */
export function refuseNestedRelationInput(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  inputData: Record<string, unknown> | undefined,
): void {
  if (inputData === undefined) return
  for (const [fieldKey, value] of Object.entries(inputData)) {
    if (!isRelationship(listConfig.fields[fieldKey])) continue
    const kinds = refusedKindsIn(value)
    if (kinds.length > 0) throw new NestedRelationInputError(listName, fieldKey, kinds)
  }
}
