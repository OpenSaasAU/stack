import { humanActor, isActorUserId, sessionWithActor } from '../access/actor.js'
import {
  isProcedure,
  type Procedure,
  type ProcedureHostContext,
  type ProcedureRegistry,
} from './procedure.js'
import { ProcedureHostError } from './validate.js'

/** The procedure registered under `name` as an own property and exposed to `'web'`, if any. */
export function webProcedureOf<C extends ProcedureHostContext>(
  procedures: ProcedureRegistry<C>,
  name: string,
): Procedure<C> | undefined {
  if (!Object.hasOwn(procedures, name)) return undefined
  const found = procedures[name]
  if (!isProcedure<C>(found) || !found.expose.includes('web')) return undefined
  return found
}

/**
 * The session a web host hands on for what the application's `getSession`
 * resolved: `null` when there is none, otherwise a copy carrying a human actor
 * built from the session's own `userId`. See ADR-0086.
 *
 * @throws {ProcedureHostError} when the resolved value is not an object, or has no usable `userId`.
 */
export function webSessionOf<S extends object>(resolved: S | null | undefined): S | null {
  if (resolved === null || resolved === undefined) return null
  if (typeof resolved !== 'object') {
    throw new ProcedureHostError(
      `getSession resolved a ${typeof resolved}; it must resolve a session object, null or undefined.`,
    )
  }
  const userId: unknown = Object.hasOwn(resolved, 'userId')
    ? Reflect.get(resolved, 'userId')
    : undefined
  if (!isActorUserId(userId)) {
    throw new ProcedureHostError(
      'getSession resolved a signed-in session with no usable `userId`, so the host cannot say who is acting. ' +
        '`userId` must be an own property of the session holding a non-empty string or a finite number. ' +
        "With @opensaas/stack-auth, include it in `authPlugin({ sessionFields })`, for example `sessionFields: ['userId', 'email']`.",
    )
  }
  return sessionWithActor(resolved, humanActor(userId))
}
