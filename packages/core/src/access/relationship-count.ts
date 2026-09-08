import type { Session, AccessContext, PrismaFilter } from './types.js'
import type { ListConfig, FieldConfig } from '../config/types.js'
import { checkAccess } from './engine.js'

/**
 * What a to-many relationship count is allowed to see (issue #732).
 *
 * The counts themselves are the secured read's — a relation reduced through
 * `.count()` or `.combine()` is scoped by the related list's own `query`
 * access by the engine. What survives here is the shared resolution of that
 * access into a per-relation entry, which `access-filter.ts` still needs for a
 * caller-supplied `_count` (issue #1087).
 *
 * A count comparison is no longer expressible as a filter: Prisma 8 cannot
 * compare a relation count in a `where`, and the id-list resolver that used to
 * fake one is gone. A to-many Filter spec emits `some`/`none` for presence and
 * degrades any other comparison to free text (ADR-0055).
 */

type CountArgs = {
  session: Session | null
  context: AccessContext
}

/**
 * Whether a field is a to-many relationship — the only field kind that carries a
 * relationship count (a to-one relationship has at most one related row).
 */
export function isToManyRelationshipField(field: FieldConfig | undefined): boolean {
  return (
    field?.type === 'relationship' &&
    'many' in field &&
    field.many === true &&
    'ref' in field &&
    typeof field.ref === 'string' &&
    field.ref.length > 0
  )
}

/** The per-relation entry the count `_count.select` uses for one relationship. */
export type CountAccessEntry =
  | { kind: 'all' } // related list fully readable → count every related row
  | { kind: 'scoped'; where: PrismaFilter } // count only rows matching the access filter
  | { kind: 'denied' } // related list not readable at all → count is always 0

/**
 * Resolve one related list's operation-level `query` access directly into the
 * entry its `_count` select needs — `access-filter.ts`'s caller-`_count`
 * scoping (issue #1087), which already has the related list resolved,
 * including a synthetic back-relation's, which has no field of its own on the
 * counting list.
 */
export async function resolveCountAccessEntryForList(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  args: CountArgs,
): Promise<CountAccessEntry> {
  const queryAccess = relatedListConfig.access?.operation?.query
  const result = await checkAccess(queryAccess, { session: args.session, context: args.context })

  if (result === false) return { kind: 'denied' }
  if (typeof result === 'object') return { kind: 'scoped', where: result }
  return { kind: 'all' }
}
