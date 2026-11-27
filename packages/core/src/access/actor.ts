/** A person on the web: set by the procedure HTTP host and by the in-process caller. */
export interface HumanActor {
  readonly kind: 'human'
  /** The signed-in user's id, exactly as the session carries it under `userId`. */
  readonly userId: string | number
  readonly via: 'web'
}

/** An OAuth client calling through the MCP host on behalf of a user. */
export interface AgentActor {
  readonly kind: 'agent'
  /** The OAuth client id the host verified. */
  readonly clientId: string
  /** The id of the user the agent acts for. The session's `userId` is the same value. */
  readonly onBehalfOf: string | number
  readonly via: 'mcp'
}

/**
 * Who a host-built session says is acting. Only a host mints one: the
 * procedure HTTP host and the in-process caller (`createServerCaller`) a human
 * from the session `getSession` resolves, the MCP handler an agent. An `actor`
 * no host minted, or one minted for a different `userId` than the session's
 * own, is removed before the session reaches an access rule, a hook or a
 * transaction, so a token, a session provider or code spreading one into
 * `getContext` cannot choose it; an application chooses identity only through
 * the `getSession` it gives a host. The actor is frozen, and so is the session
 * a context carries.
 *
 * A session a host did not build carries none, and an absent actor is never a
 * human: a rule checks positively for the kind it wants.
 *
 * @example
 * ```typescript
 * import type { AccessControl } from '@opensaas/stack-core'
 *
 * const humansOnly: AccessControl = ({ session }) => session?.actor?.kind === 'human'
 * ```
 */
export type Actor = HumanActor | AgentActor

const mintedActors = new WeakMap<object, Actor>()
const sealedSessions = new WeakSet<object>()

export function humanActor(userId: string | number): HumanActor {
  const actor: HumanActor = Object.freeze({ kind: 'human', userId, via: 'web' })
  mintedActors.set(actor, actor)
  return actor
}

export function agentActor(clientId: string, onBehalfOf: string | number): AgentActor {
  const actor: AgentActor = Object.freeze({ kind: 'agent', clientId, onBehalfOf, via: 'mcp' })
  mintedActors.set(actor, actor)
  return actor
}

export function isActorUserId(value: unknown): value is string | number {
  return typeof value === 'string' ? value !== '' : Number.isFinite(value)
}

export function isActorClientId(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function mintedActorOf(value: unknown): Actor | undefined {
  return typeof value === 'object' && value !== null ? mintedActors.get(value) : undefined
}

function actsFor(actor: Actor, session: object): boolean {
  const held = Object.getOwnPropertyDescriptor(session, 'userId')
  const userId: unknown = held !== undefined && 'value' in held ? held.value : undefined
  return (actor.kind === 'human' ? actor.userId : actor.onBehalfOf) === userId
}

function copyWithActor<S extends object>(session: S, actor: Actor | undefined): S {
  const prototype: object | null = Object.getPrototypeOf(session)
  const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(session)
  delete descriptors.actor
  const copy: S = Object.create(prototype, descriptors)
  if (actor !== undefined) {
    Object.defineProperty(copy, 'actor', { value: actor, enumerable: true })
  } else if ('actor' in copy) {
    Object.defineProperty(copy, 'actor', { value: undefined, enumerable: false })
  }
  return copy
}

/** A copy of `session`, prototype kept, carrying `actor` in place of any it held. */
export function sessionWithActor<S extends object>(session: S, actor: Actor): S {
  return copyWithActor(session, actor)
}

/**
 * The session a context carries: a frozen shallow copy of the one it was
 * given, keeping `actor` only when a host minted it for this session's own
 * `userId`. The caller's own object
 * is left as it was, and sealing a sealed session returns it unchanged.
 */
export function sealSession<S extends object>(session: S): S {
  if (sealedSessions.has(session)) return session
  const held = Object.getOwnPropertyDescriptor(session, 'actor')
  const value: unknown = held !== undefined && 'value' in held ? held.value : undefined
  const minted = mintedActorOf(value)
  const copy = copyWithActor(
    session,
    minted !== undefined && actsFor(minted, session) ? minted : undefined,
  )
  Object.freeze(copy)
  sealedSessions.add(copy)
  return copy
}

/** `context`, with `session` made non-writable and non-configurable in place. */
export function bindSessionReadOnly<T extends { session: unknown }>(context: T): T {
  Object.defineProperty(context, 'session', { writable: false, configurable: false })
  return context
}
