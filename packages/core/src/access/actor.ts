/** A person calling through the web host. */
export interface HumanActor {
  readonly kind: 'human'
  /** The signed-in user's id, as the session carries it under `userId`. */
  readonly userId: string
  readonly via: 'web'
}

/** An OAuth client calling through the MCP host on behalf of a user. */
export interface AgentActor {
  readonly kind: 'agent'
  /** The OAuth client id the host verified. */
  readonly clientId: string
  /** The id of the user the agent acts for. The session's `userId` is the same value. */
  readonly onBehalfOf: string
  readonly via: 'mcp'
}

/**
 * Who a host-built session says is acting. A host sets it on `session.actor`
 * after it has copied the session's own fields, so nothing a caller, a token
 * or a session provider supplies can choose it.
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

export function humanActor(userId: string): HumanActor {
  return Object.freeze({ kind: 'human', userId, via: 'web' })
}

export function agentActor(clientId: string, onBehalfOf: string): AgentActor {
  return Object.freeze({ kind: 'agent', clientId, onBehalfOf, via: 'mcp' })
}

export function isActorId(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}
