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
 *
 * A framework's control flow is rethrown, so the framework still acts on it:
 * a throw whose string `digest` starts with one of Next.js's control-flow
 * prefixes (`redirect()`, `notFound()` and the other HTTP fallbacks, dynamic
 * usage and client-rendering bailouts, a hanging prerender promise), and
 * React's postpone. Any other `digest` is an ordinary throw.
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
    if (isControlFlow(err)) throw err
    console.warn(policy.warning(subject), err)
    return denied
  }
}

const NEXT_CONTROL_FLOW_DIGEST_PREFIXES: readonly string[] = [
  'NEXT_REDIRECT',
  'NEXT_HTTP_ERROR_FALLBACK',
  'NEXT_NOT_FOUND',
  'DYNAMIC_SERVER_USAGE',
  'BAILOUT_TO_CLIENT_SIDE_RENDERING',
  'HANGING_PROMISE_REJECTION',
]

const REACT_POSTPONE = Symbol.for('react.postpone')

function isControlFlow(thrown: unknown): boolean {
  if (typeof thrown !== 'object' || thrown === null) return false
  if ('$$typeof' in thrown && thrown.$$typeof === REACT_POSTPONE) return true
  if (!('digest' in thrown) || typeof thrown.digest !== 'string') return false
  const digest = thrown.digest
  return NEXT_CONTROL_FLOW_DIGEST_PREFIXES.some((prefix) => digest.startsWith(prefix))
}
