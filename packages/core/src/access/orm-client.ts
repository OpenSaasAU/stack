import type { OrmClient, OrmModelDelegate } from './types.js'
import { getDbKey } from '../lib/case-utils.js'

/**
 * Thrown when the ORM client carries no delegate for a list the config
 * declares — the client and the config disagree about what the database
 * holds, which is a generation or wiring fault rather than an access denial,
 * so it is reported rather than silently treated as an empty result.
 */
export class OrmModelMissingError extends Error {
  constructor(readonly listName: string) {
    super(
      `The ORM client has no model for list "${listName}" (expected key "${getDbKey(listName)}"). ` +
        `Re-run \`opensaas generate\` so the emitted contract matches the config.`,
    )
    this.name = 'OrmModelMissingError'
  }
}

/**
 * Presence, not completeness. A test double legitimately implements only the
 * operations the test reaches, so demanding all seven would reject a client
 * the engine can drive; a missing operation surfaces at its own call site.
 */
function isDelegate(value: unknown): value is OrmModelDelegate {
  return typeof value === 'object' && value !== null
}

/**
 * Resolve one list's delegate off the ORM client. List names are config values
 * resolved at runtime, so the client is indexed by key and the result checked
 * rather than assumed — this is the single place that step happens, and the
 * reason {@link OrmClient} needs no per-model type.
 */
export function ormModel(prisma: OrmClient, listName: string): OrmModelDelegate {
  const delegate = prisma[getDbKey(listName)]
  if (!isDelegate(delegate)) {
    throw new OrmModelMissingError(listName)
  }
  return delegate
}
