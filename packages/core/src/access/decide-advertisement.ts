/** How one consumer words a contained throw. */
export interface AdvertisementPolicy {
  readonly warning: (subject: string) => string
}

/**
 * Decide what one access question advertises, treating anything thrown while
 * deciding as `denied`.
 *
 * A listing evaluates every rule across a list, so a rule that throws —
 * `({ session }) => session.role === 'admin'` reached by a session-less
 * request, say — would otherwise fail the whole listing over one question.
 * Containment is the advertisement's alone: the rule still throws when the
 * field is read or written (ADR-0030, ADR-0053). The catch is deliberately
 * broad — an `InvalidFieldAccessResultError` costs the question its answer just
 * as a throwing rule does — and every contained throw warns, or a denial would
 * have no diagnostic at all.
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
    console.warn(policy.warning(subject), err)
    return denied
  }
}
