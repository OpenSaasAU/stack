import { withUnmemoisedSessionVocabulary } from '../access/session-vocabulary.js'
import { engineContextOf, type AnyStackContext } from './engine-context.js'

/**
 * `context`, marked as held for the life of the process, as the generated
 * `rawOpensaasContext` is: its session vocabulary answers each ask afresh
 * rather than keeping answers no request bounds (ADR-0084).
 */
export function processLifetimeContext<TContext extends AnyStackContext>(
  context: TContext,
): TContext {
  const engine = engineContextOf(context)
  if (engine._config !== undefined) withUnmemoisedSessionVocabulary(engine, engine._config)
  return context
}
