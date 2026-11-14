import { InvalidFieldAccessResultError } from './errors.js'

/** How one consumer words a contained throw, and whether a config error propagates. */
export interface AdvertisementPolicy {
  readonly warning: (subject: string) => string
  readonly propagatesConfigErrors?: boolean
}

/**
 * Decide what one access question advertises, treating anything thrown while
 * deciding as `denied`.
 *
 * A listing evaluates every rule across a list, so a rule that throws —
 * `({ session }) => session.role === 'admin'` reached by a session-less
 * request, say — would otherwise fail the whole listing over one question.
 * Containment is the advertisement's alone: the rule still throws when the
 * field is read or written (ADR-0030, ADR-0053). Every contained throw warns,
 * or a denial would have no diagnostic at all.
 *
 * With `propagatesConfigErrors`, an `InvalidFieldAccessResultError` — a field
 * rule that returned a filter — propagates instead (ADR-0030).
 */
export async function decideAdvertisement<T>(
  subject: string,
  decide: () => Promise<T>,
  denied: T,
  policy: AdvertisementPolicy,
): Promise<T> {
  try {
    return await decide()
  } catch (err) {
    if (policy.propagatesConfigErrors === true && err instanceof InvalidFieldAccessResultError) {
      throw err
    }
    console.warn(policy.warning(subject), err)
    return denied
  }
}
