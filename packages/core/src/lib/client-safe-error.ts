import { AccessScopeDepthExceededError, ResolveOutputCycleError } from '../access/errors.js'
import {
  ConflictingRelationInputError,
  MalformedForeignKeyInputError,
  MalformedRelationInputError,
  NestedRelationInputError,
  NonOwningRelationInputError,
} from '../context/relationship-input.js'
import { ValidationError } from '../hooks/index.js'
import { DatabaseError } from './database-errors.js'

/**
 * Whether `error` may reach a client verbatim: a validation failure, a
 * stack-owned database error, or one of the engine's own refusals. Anything
 * else — a throwing access rule, a hook bug, a third-party SDK error — carries
 * internal detail and must be logged server-side and replaced with a generic
 * message. A hook that wants a message shown throws `ValidationError`.
 */
export function isClientSafeError(error: unknown): error is Error {
  return (
    error instanceof ValidationError ||
    error instanceof DatabaseError ||
    error instanceof NonOwningRelationInputError ||
    error instanceof MalformedRelationInputError ||
    error instanceof NestedRelationInputError ||
    error instanceof ConflictingRelationInputError ||
    error instanceof MalformedForeignKeyInputError ||
    error instanceof AccessScopeDepthExceededError ||
    error instanceof ResolveOutputCycleError
  )
}
