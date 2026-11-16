import type { OpenSaasConfig } from '../config/types.js'
import type { AccessContext } from './types.js'

/** How one consumer words a contained throw. */
export interface AdvertisementPolicy {
  readonly warning: (subject: string) => string
}

/** Recognises one thrown value, not its `cause` chain, as a framework's control flow. */
export type ControlFlowPredicate = (thrown: unknown) => boolean

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
 * usage and client-rendering bailouts, a hanging or interrupted prerender),
 * React's postpone, and anything `isFrameworkControlFlow` recognises. Like
 * Next's `unstable_rethrow`, an `Error` whose `cause` chain reaches one of
 * those has that cause rethrown. Any other `digest` is an ordinary throw.
 */
export async function decideAdvertisement<T>(
  subject: string,
  decide: () => Promise<T>,
  denied: T,
  policy: AdvertisementPolicy,
  isFrameworkControlFlow?: ControlFlowPredicate,
): Promise<T> {
  try {
    return await decide()
  } catch (err) {
    rethrowControlFlow(err, isFrameworkControlFlow)
    console.warn(policy.warning(subject), err)
    return denied
  }
}

/**
 * Rethrow `thrown` when it is, or is caused by, a framework's control flow as
 * {@link decideAdvertisement} recognises it; return otherwise.
 */
export function rethrowControlFlow(
  thrown: unknown,
  isFrameworkControlFlow?: ControlFlowPredicate,
): void {
  const controlFlow = controlFlowIn(thrown, isFrameworkControlFlow)
  if (controlFlow !== undefined) throw controlFlow.thrown
}

/**
 * The predicate `context` was configured with, else `config`'s: the context's
 * own config is the one its host resolved, which a caller's may not be.
 */
export function controlFlowPredicateOf(
  context: AccessContext,
  config?: OpenSaasConfig,
): ControlFlowPredicate | undefined {
  return (context._config ?? config)?.isFrameworkControlFlow
}

/**
 * A {@link ControlFlowPredicate} from a framework's own rethrow, such as
 * Next.js's `unstable_rethrow`, which throws a value it recognises and returns
 * otherwise. Only a value the rethrow throws back unchanged is recognised: one
 * that throws a link of the value's `cause` chain leaves that link for the
 * chain walk to find, so the link, not its wrapper, is what propagates.
 */
export function controlFlowFromRethrow(rethrow: (thrown: unknown) => void): ControlFlowPredicate {
  return (thrown) => {
    try {
      rethrow(thrown)
    } catch (rethrown) {
      return rethrown === thrown
    }
    return false
  }
}

/**
 * A {@link ControlFlowPredicate} recognising what `first` or `second`
 * recognises. A predicate that throws recognises nothing and is reported once,
 * so neither can make the combination throw.
 */
export function eitherControlFlow(
  first: ControlFlowPredicate,
  second: ControlFlowPredicate | undefined,
): ControlFlowPredicate {
  return (thrown) => recognises(first, thrown) || recognises(second, thrown)
}

const NEXT_CONTROL_FLOW_DIGEST_PREFIXES: readonly string[] = [
  'NEXT_REDIRECT',
  'NEXT_HTTP_ERROR_FALLBACK',
  'NEXT_NOT_FOUND',
  'DYNAMIC_SERVER_USAGE',
  'BAILOUT_TO_CLIENT_SIDE_RENDERING',
  'HANGING_PROMISE_REJECTION',
  'NEXT_PRERENDER_INTERRUPTED',
]

const MAX_CAUSE_DEPTH = 16

const REACT_POSTPONE = Symbol.for('react.postpone')

const reportedFailures = new WeakSet<ControlFlowPredicate>()

function recognises(predicate: ControlFlowPredicate | undefined, thrown: unknown): boolean {
  if (predicate === undefined) return false
  try {
    return predicate(thrown) === true
  } catch (failure) {
    if (!reportedFailures.has(predicate)) {
      reportedFailures.add(predicate)
      console.error(
        '[opensaas] isFrameworkControlFlow threw, so the value it was asked about is treated ' +
          'as not control flow. Reported once per predicate.',
        failure,
      )
    }
    return false
  }
}

function controlFlowIn(
  thrown: unknown,
  isFrameworkControlFlow: ControlFlowPredicate | undefined,
): { thrown: unknown } | undefined {
  const seen = new Set<unknown>()
  let current = thrown
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && !seen.has(current); depth++) {
    if (isControlFlow(current) || recognises(isFrameworkControlFlow, current)) {
      return { thrown: current }
    }
    if (!(current instanceof Error) || !('cause' in current)) return undefined
    seen.add(current)
    current = current.cause
  }
  return undefined
}

function isControlFlow(thrown: unknown): boolean {
  if (typeof thrown !== 'object' || thrown === null) return false
  if ('$$typeof' in thrown && thrown.$$typeof === REACT_POSTPONE) return true
  if (!('digest' in thrown) || typeof thrown.digest !== 'string') return false
  const digest = thrown.digest
  return NEXT_CONTROL_FLOW_DIGEST_PREFIXES.some((prefix) => digest.startsWith(prefix))
}
